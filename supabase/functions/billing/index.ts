import { account, checked, cors, db, errorResponse, HttpError, required, siteUrl, stripe, syncSubscription, updateAccount, userFor, withLock } from '../_shared/runtime.ts';
import { publicAccount, selectPlan } from '../_shared/plans.mjs';

export async function handleBilling(req: Request) {
  let headers: Record<string, string> = {};
  try {
    headers = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    const user = await userFor(req);
    const body = await req.json().catch(() => { throw new HttpError(400, 'Invalid request'); });
    if (body.action === 'usage') {
      const now = new Date().toISOString();
      const cycle = checked(await db.from('billing_usage_cycles').select('period_start,period_end,seconds')
        .eq('user_id', user.id).lte('period_start', now).gt('period_end', now).order('period_start', { ascending: false }).limit(1).maybeSingle());
      const row = await account(user.id);
      return Response.json({ cycle, allowance: row ? (row.plan === 'starter' ? 250 : 700) : null }, { headers });
    }
    if (body.action === 'status') {
      let row = await account(user.id);
      if (row?.stripe_subscription_id) {
        await syncSubscription(row.stripe_subscription_id);
        row = await account(user.id);
      }
      return Response.json(publicAccount(row), { headers });
    }
    if (body.action === 'portal') {
      const row = await account(user.id);
      if (!row?.stripe_customer_id) throw new HttpError(409, 'Choose a plan first');
      const portal = await stripe.billingPortal.sessions.create({
        customer: row.stripe_customer_id, return_url: `${siteUrl}/?billing=returned`,
        configuration: required('STRIPE_PORTAL_CONFIGURATION_ID'),
      });
      return Response.json({ url: portal.url }, { headers });
    }
    if (body.action === 'upgrade') {
      if (body.plan !== 'growth') throw new HttpError(400, 'Only Starter-to-Growth upgrades are available here');
      const row = await account(user.id);
      if (!row?.stripe_customer_id || !row.stripe_subscription_id || row.plan !== 'starter') throw new HttpError(409, 'An active Starter subscription is required to upgrade');
      const subscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
      if (subscription.metadata?.app !== 'ringandbooked' || subscription.metadata?.user_id !== user.id || !['active', 'trialing'].includes(subscription.status)) {
        throw new HttpError(409, 'Your subscription is not ready for an upgrade. Open your account to manage it.');
      }
      const portal = await stripe.billingPortal.sessions.create({
        customer: row.stripe_customer_id, return_url: `${siteUrl}/account.html?billing=upgrade_returned`,
        configuration: required('STRIPE_PORTAL_CONFIGURATION_ID'),
      });
      return Response.json({ url: portal.url }, { headers });
    }
    if (body.action === 'cancel_setup') {
      const existing = await account(user.id);
      if (!existing) throw new HttpError(409, 'No setup request found');
      const result = await withLock(user.id, async () => {
        const row = await account(user.id);
        if (row.stripe_subscription_id || !['awaiting_payment_method', 'pending_setup', 'canceled'].includes(row.status)) {
          throw new HttpError(409, 'Manage your subscription to cancel it');
        }
        // Save cancellation first. A late setup webhook cannot activate this account.
        await updateAccount(user.id, { status: 'canceled' });
        if (row.stripe_setup_session_id) {
          const session = await stripe.checkout.sessions.retrieve(row.stripe_setup_session_id);
          if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
        }
        return { status: 'canceled' };
      });
      return Response.json(result, { headers });
    }
    if (body.action !== 'checkout') throw new HttpError(400, 'Unknown action');
    if (Deno.env.get('BILLING_ENABLED') !== 'true') throw new HttpError(503, 'Enrollment is being prepared. Please contact us to arrange your setup.');
    try { selectPlan(body.plan, body.period); } catch { throw new HttpError(400, 'Invalid plan or billing period'); }
    if (body.consent !== true) throw new HttpError(400, 'Please accept the billing terms');
    const e2eTestMode = Deno.env.get('BILLING_E2E_TEST_MODE') === 'true';
    checked(await db.from('billing_accounts').upsert({ user_id: user.id, plan: body.plan, period: body.period }, { onConflict: 'user_id', ignoreDuplicates: true }));
    const result = await withLock(user.id, async () => {
      let row = await account(user.id);
      if (row.stripe_subscription_id || (!e2eTestMode && row.status !== 'awaiting_payment_method')) throw new HttpError(409, 'You already have a setup request or subscription. Open your account to manage it.');
      if (row.plan !== body.plan || row.period !== body.period) throw new HttpError(409, 'A different plan is already being set up. Contact us to change it.');
      if (!row.stripe_customer_id) {
        const customer = await stripe.customers.create({ email: user.email, metadata: { app: 'ringandbooked', user_id: user.id } }, { idempotencyKey: `rab-customer-${user.id}` });
        await updateAccount(user.id, { stripe_customer_id: customer.id });
        row = await account(user.id);
      }
      if (row.stripe_setup_session_id) {
        const previous = await stripe.checkout.sessions.retrieve(row.stripe_setup_session_id);
        if (previous.status === 'open' && !e2eTestMode) return { url: previous.url };
        if (previous.status === 'complete' && !e2eTestMode) throw new HttpError(409, 'Your payment method is being confirmed. Refresh your account shortly.');
        if (previous.status === 'open') await stripe.checkout.sessions.expire(previous.id);
        await updateAccount(user.id, { checkout_generation: crypto.randomUUID(), stripe_setup_session_id: null });
        row = await account(user.id);
      }
      // Stripe permanently associates an idempotency key with its first request.
      // A prior failed setup can therefore not be retried after request settings
      // change. Rotate only after a recorded failure; the lock prevents races.
      if (row.last_checkout_error) {
        await updateAccount(user.id, { checkout_generation: crypto.randomUUID(), last_checkout_error: null });
        row = await account(user.id);
      }
      let session;
      try {
        if (e2eTestMode) {
          const testPrice = required(`STRIPE_E2E_TEST_PRICE_${body.plan.toUpperCase()}_${body.period.toUpperCase()}`);
          session = await stripe.checkout.sessions.create({
            mode: 'subscription', payment_method_types: ['card'], customer: row.stripe_customer_id,
            managed_payments: { enabled: false }, client_reference_id: user.id,
            line_items: [{ price: testPrice, quantity: 1 }],
            metadata: { app: 'ringandbooked', user_id: user.id, generation: row.checkout_generation, purpose: 'e2e_live_test' },
            subscription_data: { metadata: { app: 'ringandbooked', user_id: user.id, plan: row.plan, period: row.period, purpose: 'e2e_live_test' } },
            success_url: `${siteUrl}/?billing=checkout_complete`, cancel_url: `${siteUrl}/?billing=canceled#pricing`,
          }, { idempotencyKey: `rab-e2e-subscription-${row.checkout_generation}` });
        } else {
          // Card is explicit, so Setup mode doesn't need a currency. Keeping this
          // request minimal avoids optional Checkout settings differing by account.
          session = await stripe.checkout.sessions.create({
            mode: 'setup', payment_method_types: ['card'], customer: row.stripe_customer_id,
            // The account defaults to Stripe Managed Payments, which does not
            // support Setup mode. This flow deliberately only saves a method.
            managed_payments: { enabled: false },
            client_reference_id: user.id,
            metadata: { app: 'ringandbooked', user_id: user.id, generation: row.checkout_generation },
            setup_intent_data: { metadata: { app: 'ringandbooked', user_id: user.id } },
            success_url: `${siteUrl}/?billing=setup_complete`, cancel_url: `${siteUrl}/?billing=canceled#pricing`,
          }, { idempotencyKey: `rab-setup-${row.checkout_generation}` });
        }
      } catch (error) {
        const stripeError = error as { type?: unknown; code?: unknown; statusCode?: unknown; requestId?: unknown; param?: unknown; message?: unknown };
        const providerMessage = typeof stripeError.message === 'string'
          ? stripeError.message
            .replace(/\b(?:acct|cus|cs|pm|pi|seti|req)_[A-Za-z0-9_]+\b/g, '[redacted-id]')
            .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
            .slice(0, 500)
          : null;
        const diagnostic = {
          type: typeof stripeError.type === 'string' ? stripeError.type : null,
          code: typeof stripeError.code === 'string' ? stripeError.code : null,
          statusCode: typeof stripeError.statusCode === 'number' ? stripeError.statusCode : null,
          requestId: typeof stripeError.requestId === 'string' ? stripeError.requestId : null,
          param: typeof stripeError.param === 'string' ? stripeError.param : null,
          message: providerMessage,
          occurredAt: new Date().toISOString(),
        };
        await updateAccount(user.id, { last_checkout_error: diagnostic });
        // Keep provider diagnostics searchable in Supabase logs without exposing
        // request bodies, card data, or credentials.
        console.error('Stripe Checkout creation failed', JSON.stringify(diagnostic));
        throw error;
      }
      await updateAccount(user.id, { stripe_setup_session_id: session.id, last_checkout_error: null });
      return { url: session.url };
    });
    return Response.json(result, { headers });
  } catch (error) { return errorResponse(error, headers); }
}
if (import.meta.main) Deno.serve(handleBilling);
