import { account, checked, db, errorResponse, HttpError, required, stripe, withLock } from '../_shared/runtime.ts';

async function authenticate(req: Request) {
  const token = req.headers.get('x-usage-token') || '';
  const expected = required('USAGE_REPORTING_TOKEN');
  if (expected.length < 32) throw new Error('Usage token must have at least 32 characters');
  const hash = (s: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const [a, b] = await Promise.all([hash(token), hash(expected)]);
  let diff = 0;
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  if (diff) throw new HttpError(401, 'Unauthorized');
}
export async function handleUsage(req: Request) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    await authenticate(req);
    const body = await req.json();
    if (!/^[0-9a-f-]{36}$/i.test(body.userId || '')) throw new HttpError(400, 'Invalid account');
    const row = await account(body.userId);
    if (!row?.stripe_subscription_id) throw new HttpError(409, 'No subscription');
    const result = await withLock(body.userId, async () => {
      if (body.action !== 'retry') {
        if (!/^[a-zA-Z0-9:_-]{1,200}$/.test(body.callId || '') || !Number.isSafeInteger(body.seconds) || body.seconds < 0 || body.seconds > 86400) throw new HttpError(400, 'Invalid call');
        const ended = new Date(body.endedAt).getTime();
        if (!Number.isFinite(ended) || ended > Date.now()) throw new HttpError(400, 'Invalid call timestamp');
        const existing = checked(await db.from('billing_usage_calls').select('*').eq('call_id', body.callId).maybeSingle());
        if (existing) {
          if (existing.user_id !== row.user_id || existing.seconds !== body.seconds || new Date(existing.ended_at).getTime() !== ended) throw new HttpError(409, 'Conflicting duplicate call');
        } else {
          const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
          if (!['active', 'trialing'].includes(sub.status)) throw new HttpError(409, 'Subscription is not active');
          const item = sub.items.data.find(i => i.price.id === required('STRIPE_PRICE_OVERAGE'));
          if (!item) throw new Error('Usage subscription item missing');
          const start = sub.status === 'trialing' ? sub.trial_start! : item.current_period_start;
          const end = sub.status === 'trialing' ? sub.trial_end! : item.current_period_end;
          // Never silently place late usage on a different month's invoice.
          if (ended / 1000 < start || ended / 1000 >= end) throw new HttpError(409, 'Call falls outside current usage period; reconcile before billing');
          checked(await db.rpc('record_billing_call', {
            p_user_id: row.user_id, p_call_id: body.callId, p_seconds: body.seconds,
            p_ended_at: new Date(ended).toISOString(), p_period_start: new Date(start * 1000).toISOString(),
            p_period_end: new Date(end * 1000).toISOString(), p_free_trial: sub.status === 'trialing',
          }));
        }
      }
      const pending = checked(await db.from('billing_usage_calls').select('*').eq('user_id', row.user_id).is('delivered_at', null).order('created_at').limit(100)) || [];
      for (const call of pending) {
        // Stripe idempotency/event identifiers have bounded deduplication windows.
        // Stop for reconciliation after 23h instead of risking a duplicate charge.
        if (call.first_attempt_at && Date.now() - new Date(call.first_attempt_at).getTime() > 23 * 3600000) throw new HttpError(409, 'Usage delivery needs manual reconciliation');
        if (!call.first_attempt_at) checked(await db.from('billing_usage_calls').update({ first_attempt_at: new Date().toISOString() }).eq('call_id', call.call_id));
        await stripe.billing.meterEvents.create({
          event_name: required('STRIPE_METER_EVENT_NAME'), identifier: call.event_id,
          timestamp: Math.floor(new Date(call.ended_at).getTime() / 1000),
          payload: { stripe_customer_id: row.stripe_customer_id, value: String(call.billable_minutes) },
        }, { idempotencyKey: `rab-usage-${call.event_id}` });
        checked(await db.from('billing_usage_calls').update({ delivered_at: new Date().toISOString() }).eq('call_id', call.call_id));
      }
      return { received: true, delivered: pending.length };
    });
    return Response.json(result);
  } catch (error) { return errorResponse(error); }
}
if (import.meta.main) Deno.serve(handleUsage);
