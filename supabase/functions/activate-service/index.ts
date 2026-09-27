import { account, errorResponse, HttpError, required, stripe, syncSubscription, updateAccount, userFor, withLock } from '../_shared/runtime.ts';
import { selectPlan, TRIAL_DAYS } from '../_shared/plans.mjs';

// Staff-only operation, called AFTER forwarding/booking/agent tests pass.
// app_metadata is assigned by a trusted Supabase admin, never by signup metadata.
export async function handleActivation(req: Request) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    const admin = await userFor(req);
    if (admin.app_metadata?.billing_admin !== true) throw new HttpError(403, 'Staff access required');
    const body = await req.json();
    if (body.serviceReady !== true || !/^[0-9a-f-]{36}$/i.test(body.userId || '')) throw new HttpError(400, 'Confirm that this customer’s phone service is live');
    if (Deno.env.get('BILLING_ENABLED') !== 'true' || Deno.env.get('USAGE_BILLING_READY') !== 'true') throw new HttpError(503, 'Billing and usage reporting must be tested before activation');
    const existing = await account(body.userId);
    if (!existing) throw new HttpError(404, 'Account not found');
    const result = await withLock(body.userId, async () => {
      let row = await account(body.userId);
      if (row.stripe_subscription_id) {
        await syncSubscription(row.stripe_subscription_id);
        return { subscriptionId: row.stripe_subscription_id, alreadyActivated: true };
      }
      if (!['pending_setup', 'starting'].includes(row.status) || !row.stripe_payment_method_id) throw new HttpError(409, 'Customer must save a payment method first');
      const p = selectPlan(row.plan, row.period);
      const priceId = required(`STRIPE_PRICE_${row.plan.toUpperCase()}_${row.period.toUpperCase()}`);
      const usagePriceId = required('STRIPE_PRICE_OVERAGE');
      const price = await stripe.prices.retrieve(priceId);
      const usage = await stripe.prices.retrieve(usagePriceId);
      if (!price.active || price.currency !== 'usd' || price.unit_amount !== p.amount || price.recurring?.interval !== (row.period === 'monthly' ? 'month' : 'year') || price.recurring?.interval_count !== 1) throw new Error('Base price mismatch');
      if (!usage.active || usage.unit_amount !== 35 || usage.currency !== 'usd' || usage.recurring?.interval !== 'month' || usage.recurring?.usage_type !== 'metered' || !usage.recurring.meter) throw new Error('Usage price mismatch');
      // A stable trial end and idempotency key make retries safe after partial failures.
      if (!row.activated_at) {
        const now = Date.now();
        await updateAccount(row.user_id, { status: 'starting', activated_at: new Date(now).toISOString(), trial_end: new Date(now + TRIAL_DAYS * 86400000).toISOString() });
        row = await account(row.user_id);
      }
      // Recover even if Stripe's 24-hour idempotency cache has expired.
      const subscriptions = await stripe.subscriptions.list({ customer: row.stripe_customer_id, status: 'all', limit: 100 });
      const previous = subscriptions.data.find(s => s.metadata.app === 'ringandbooked' && s.metadata.user_id === row.user_id);
      if (previous) { await syncSubscription(previous.id); return { subscriptionId: previous.id, alreadyActivated: true }; }
      if (subscriptions.has_more) throw new Error('Subscription history requires review');
      const trialEnd = Math.floor(new Date(row.trial_end).getTime() / 1000);
      if (trialEnd <= Date.now() / 1000 + 60) throw new HttpError(409, 'Activation retry window expired; staff review required');
      const sub = await stripe.subscriptions.create({
        customer: row.stripe_customer_id,
        default_payment_method: row.stripe_payment_method_id,
        items: [{ price: priceId }, { price: usagePriceId }],
        billing_mode: { type: 'flexible' }, trial_end: trialEnd,
        trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
        metadata: { app: 'ringandbooked', user_id: row.user_id, plan: row.plan, period: row.period },
      }, { idempotencyKey: `rab-activate-${row.user_id}` });
      await syncSubscription(sub.id);
      return { subscriptionId: sub.id, trialEnd: row.trial_end };
    });
    return Response.json(result);
  } catch (error) { return errorResponse(error); }
}
if (import.meta.main) Deno.serve(handleActivation);
