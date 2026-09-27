// Run only with a server-side key in the environment. Never paste keys into HTML.
import { writeFile } from 'node:fs/promises';
import { PLANS } from '../supabase/functions/_shared/plans.mjs';
const key = process.env.STRIPE_SECRET_KEY;
const live = process.argv.includes('--live');
if (!key || !key.startsWith(live ? 'sk_live_' : 'sk_test_')) throw new Error(`Provide a ${live ? 'live' : 'test'} STRIPE_SECRET_KEY in your environment`);
const apiVersion = '2025-08-27.basil';
function form(data, prefix = '', result = new URLSearchParams()) {
  for (const [k, v] of Object.entries(data)) {
    const field = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object') form(v, field, result);
    else if (v !== undefined && v !== null) result.append(field, String(v));
  }
  return result;
}
async function request(path, data, idempotencyKey) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': apiVersion, ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': idempotencyKey } : {}) }, body: data ? form(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Stripe setup failed (${response.status}, ${result.error?.code || result.error?.type || 'unknown'}); inspect Stripe request logs`);
  return result;
}
async function list(path) {
  const items = []; let cursor;
  do {
    const page = await request(`${path}${path.includes('?') ? '&' : '?'}limit=100${cursor ? `&starting_after=${cursor}` : ''}`);
    items.push(...page.data); cursor = page.has_more ? page.data.at(-1).id : null;
  } while(cursor);
  return items;
}
const account = await request('account');
const expected = process.env.STRIPE_EXPECTED_ACCOUNT_ID;
if (!expected || account.id !== expected) throw new Error('Set STRIPE_EXPECTED_ACCOUNT_ID to the intended Stripe account ID; current key does not match');
const output = { STRIPE_MODE: live ? 'live' : 'test', SITE_URL: process.env.SITE_URL || 'https://ringandbooked.com', BILLING_ENABLED: 'false', USAGE_BILLING_READY: 'false' };
let products = await list('products');
for (const [name, plan] of Object.entries(PLANS)) {
  let product = products.find(p => p.metadata?.app === 'ringandbooked' && p.metadata?.plan === name);
  if (!product) product = await request('products', { name: `Ring & Booked ${plan.name}`, description: `${plan.minutes} included minutes per month. Additional minutes $0.35/min, billed monthly.`, metadata: { app: 'ringandbooked', plan: name } }, `rab-product-${name}-v1`);
  for (const period of ['monthly', 'annually']) {
    const lookup = `rab_${name}_${period}_v1`;
    let price = (await request(`prices?lookup_keys[]=${lookup}`)).data[0];
    if (!price) price = await request('prices', { product: product.id, currency: 'usd', unit_amount: plan[period], recurring: { interval: period === 'monthly' ? 'month' : 'year' }, lookup_key: lookup }, lookup);
    if (!price.active || price.unit_amount !== plan[period] || price.currency !== 'usd' || price.product !== product.id || price.recurring?.interval !== (period === 'monthly' ? 'month' : 'year')) throw new Error(`Existing ${lookup} differs from advertised price`);
    output[`STRIPE_PRICE_${name.toUpperCase()}_${period.toUpperCase()}`] = price.id;
  }
}
let meter = (await list('billing/meters')).find(m => m.event_name === 'rab_overage_minutes_v1');
if (!meter) meter = await request('billing/meters', { display_name: 'Ring & Booked overage minutes', event_name: 'rab_overage_minutes_v1', default_aggregation: { formula: 'sum' }, customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' }, value_settings: { event_payload_key: 'value' } }, 'rab-meter-v1');
if (meter.status !== 'active' || meter.default_aggregation.formula !== 'sum') throw new Error('Unexpected meter configuration');
let usageProduct = products.find(p => p.metadata?.app === 'ringandbooked' && p.metadata?.plan === 'overage');
if (!usageProduct) usageProduct = await request('products', { name: 'Ring & Booked additional minutes', metadata: { app: 'ringandbooked', plan: 'overage' } }, 'rab-product-overage-v1');
let usagePrice = (await request('prices?lookup_keys[]=rab_overage_v1')).data[0];
if (!usagePrice) usagePrice = await request('prices', { product: usageProduct.id, currency: 'usd', unit_amount: 35, recurring: { interval: 'month', usage_type: 'metered', meter: meter.id }, lookup_key: 'rab_overage_v1' }, 'rab-overage-v1');
if (!usagePrice.active || usagePrice.unit_amount !== 35 || usagePrice.recurring?.meter !== meter.id || usagePrice.recurring?.interval !== 'month') throw new Error('Unexpected overage price');
output.STRIPE_PRICE_OVERAGE = usagePrice.id;
output.STRIPE_METER_EVENT_NAME = meter.event_name;
let portal = (await list('billing_portal/configurations')).find(c => c.metadata?.app === 'ringandbooked');
if (!portal) portal = await request('billing_portal/configurations', {
  business_profile: { headline: 'Manage your Ring & Booked subscription' },
  default_return_url: output.SITE_URL,
  features: { customer_update: { enabled: true, allowed_updates: ['email', 'address'] }, invoice_history: { enabled: true }, payment_method_update: { enabled: true }, subscription_cancel: { enabled: true, mode: 'at_period_end' }, subscription_update: { enabled: false } },
  metadata: { app: 'ringandbooked' },
}, 'rab-portal-v1');
if (!portal.active || !portal.features.subscription_cancel.enabled || !portal.features.payment_method_update.enabled) throw new Error('Portal must support cancellation and payment method updates');
output.STRIPE_PORTAL_CONFIGURATION_ID = portal.id;
await writeFile('.env.stripe.generated', Object.entries(output).map(([k,v]) => `${k}=${v}`).join('\n')+'\n', { mode: 0o600 });
console.log(`Configured ${live ? 'live' : 'test'} catalog and customer portal for ${account.id}. Non-secret IDs saved to .env.stripe.generated. Billing remains disabled pending deployment and tests.`);
