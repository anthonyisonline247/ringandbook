import Stripe from 'npm:stripe@18.5.0';
import { account, errorResponse, required, stripe, syncSubscription, updateAccount, withLock } from '../_shared/runtime.ts';

export async function handleWebhook(req: Request) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), req.headers.get('stripe-signature') || '', required('STRIPE_WEBHOOK_SECRET'), undefined, Stripe.createSubtleCryptoProvider());
  } catch { return new Response('Invalid signature', { status: 400 }); }
  try {
    if (event.livemode !== (required('STRIPE_MODE') === 'live')) throw new Error('Stripe mode mismatch');
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === 'setup' && session.metadata?.app === 'ringandbooked') {
        const userId = session.metadata.user_id;
        const original = await account(userId);
        if (!original) throw new Error('Account not yet available');
        await withLock(userId, async () => {
          const row = await account(userId);
          if (row.stripe_customer_id !== session.customer || row.checkout_generation !== session.metadata?.generation) throw new Error('Checkout ownership mismatch');
          if (row.status !== 'awaiting_payment_method') return;
          const intentId = typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent?.id;
          if (!intentId) throw new Error('Missing setup intent');
          const intent = await stripe.setupIntents.retrieve(intentId);
          if (intent.status !== 'succeeded' || intent.customer !== row.stripe_customer_id) throw new Error('Payment method not confirmed');
          const paymentMethod = typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id;
          if (!paymentMethod) throw new Error('Missing payment method');
          await stripe.customers.update(row.stripe_customer_id, { invoice_settings: { default_payment_method: paymentMethod } });
          await updateAccount(userId, { stripe_payment_method_id: paymentMethod, stripe_setup_session_id: session.id, status: 'pending_setup' });
        });
      }
    } else if (event.type.startsWith('customer.subscription.')) {
      const sub = event.data.object as Stripe.Subscription;
      if (sub.metadata?.app === 'ringandbooked') {
        // Serialize with activation so a delayed create event cannot overwrite a cancellation.
        const row = await account(sub.metadata.user_id);
        if (row) await withLock(row.user_id, () => syncSubscription(sub.id));
      }
    } else if (['invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required'].includes(event.type)) {
      const invoice = event.data.object as Stripe.Invoice;
      const ref = invoice.parent?.subscription_details?.subscription;
      const id = typeof ref === 'string' ? ref : ref?.id;
      if (id) {
        const sub = await stripe.subscriptions.retrieve(id);
        const row = sub.metadata.app === 'ringandbooked' ? await account(sub.metadata.user_id) : null;
        if (row) await withLock(row.user_id, () => syncSubscription(id));
      }
    }
    return Response.json({ received: true });
  } catch (error) { return errorResponse(error); }
}
if (import.meta.main) Deno.serve(handleWebhook);
