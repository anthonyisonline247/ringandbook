import Stripe from 'npm:stripe@18.5.0';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { validStripeKey } from './stripe-key.mjs';

export function required(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server setting: ${name}`);
  return value;
}
export const stripeMode = required('STRIPE_MODE');
const stripeKey = stripeMode === 'live'
  ? (Deno.env.get('STRIPE_RING_BOOK_LIVE_SECRET_KEY') || Deno.env.get('STRIPE_LIVE_SECRET_KEY') || required('STRIPE_SECRET_KEY'))
  : required('STRIPE_SECRET_KEY');
if (!validStripeKey(stripeKey, stripeMode)) throw new Error('Stripe key/mode mismatch');
export const stripe = new Stripe(stripeKey, {
  apiVersion: '2025-08-27.basil', httpClient: Stripe.createFetchHttpClient(),
});
const rawDb = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
// Test fixtures must never share billing state with future paying customers.
export const db = new Proxy(rawDb, { get(target, property) {
  if (property === 'from') return (name: string) => target.from(stripeMode === 'test' ? name.replace(/^billing_/, 'billing_test_') : name);
  if (property === 'rpc') return (name: string, args: Record<string, unknown>) => target.rpc(stripeMode === 'test' ? ({ lock_billing: 'lock_test_billing', record_billing_call: 'record_test_billing_call' }[name] || name) : name, args);
  return Reflect.get(target, property);
}});
export const siteUrl = required('SITE_URL').replace(/\/$/, '');
if (!/^https:\/\//.test(siteUrl)) throw new Error('SITE_URL must use HTTPS');
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function cors(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && origin !== siteUrl) throw new HttpError(403, 'Origin not allowed');
  return { 'Access-Control-Allow-Origin': siteUrl, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
}
export async function userFor(req: Request) {
  const bearer = req.headers.get('authorization') || '';
  if (!bearer.startsWith('Bearer ')) throw new HttpError(401, 'Please sign in again');
  const { data, error } = await db.auth.getUser(bearer.slice(7));
  if (error || !data.user) throw new HttpError(401, 'Please sign in again');
  return data.user;
}
export function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new Error('Database operation failed');
  return result.data;
}
export async function account(userId: string) {
  return checked(await db.from('billing_accounts').select('*').eq('user_id', userId).maybeSingle());
}
export async function updateAccount(userId: string, values: Record<string, unknown>) {
  checked(await db.from('billing_accounts').update({ ...values, updated_at: new Date().toISOString() }).eq('user_id', userId));
}
export async function withLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const token = crypto.randomUUID();
  const acquired = checked(await db.rpc('lock_billing', { p_user_id: userId, p_token: token }));
  if (!acquired) throw new HttpError(409, 'Your billing request is already being processed. Please retry shortly.');
  try { return await fn(); }
  finally { checked(await db.from('billing_operations').delete().eq('user_id', userId).eq('token', token)); }
}
export async function syncSubscription(subscriptionId: string) {
  // Fetch current state instead of trusting a possibly delayed webhook payload.
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const row = checked(await db.from('billing_accounts').select('*').eq('stripe_customer_id', customerId).maybeSingle());
  if (!row || sub.metadata.app !== 'ringandbooked' || sub.metadata.user_id !== row.user_id) return;
  if (row.stripe_subscription_id && row.stripe_subscription_id !== sub.id) throw new Error('Unexpected second subscription');
  await updateAccount(row.user_id, {
    stripe_subscription_id: sub.id, status: sub.status,
    trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end,
  });
}
export function errorResponse(error: unknown, headers: Record<string, string> = {}) {
  const known = error instanceof HttpError;
  // Do not log SDK objects, keys, payment details or raw request bodies.
  if (!known) console.error('Billing operation failed; inspect provider logs using the request time.');
  return Response.json({ error: known ? error.message : 'Billing is temporarily unavailable. Please try again or contact support.' }, { status: known ? error.status : 503, headers });
}
