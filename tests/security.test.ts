import assert from 'node:assert/strict';
Deno.env.set('SUPABASE_URL', 'https://supabase.invalid');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'fake-test-key');
Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_fake_not_a_credential');
Deno.env.set('STRIPE_WEBHOOK_SECRET', 'whsec_test_fixture');
Deno.env.set('SITE_URL', 'https://ringandbooked.com');
Deno.env.set('STRIPE_MODE', 'test');
Deno.env.set('USAGE_REPORTING_TOKEN', 'test-fixture-usage-token-more-than-32-characters');
const { handleBilling } = await import('../supabase/functions/billing/index.ts');
const { handleActivation } = await import('../supabase/functions/activate-service/index.ts');
const { handleWebhook } = await import('../supabase/functions/stripe-webhook/index.ts');
const { handleUsage } = await import('../supabase/functions/report-usage/index.ts');
const { db, stripe } = await import('../supabase/functions/_shared/runtime.ts');
function req(body = {}, headers = {}) { return new Request('https://functions.invalid/billing', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); }
Deno.test('unsigned billing and activation requests are rejected', async () => {
  assert.equal((await handleBilling(req({ action: 'checkout', userId: 'someone-else' }))).status, 401);
  assert.equal((await handleActivation(req({ serviceReady: true }))).status, 401);
});
Deno.test('untrusted browser origin is rejected before authentication', async () => {
  assert.equal((await handleBilling(req({}, { Origin: 'https://attacker.invalid' }))).status,403);
});
Deno.test('CORS preflight is narrowly scoped', async () => {
  const response = await handleBilling(new Request('https://functions.invalid', { method: 'OPTIONS', headers: { Origin: 'https://ringandbooked.com' } }));
  assert.equal(response.status,204); assert.equal(response.headers.get('access-control-allow-origin'),'https://ringandbooked.com');
});
Deno.test('invalid webhook signature cannot mutate subscription state', async () => {
  assert.equal((await handleWebhook(req({ type: 'checkout.session.completed' }))).status,400);
});
Deno.test('valid but wrong-mode webhook is not applied', async () => {
  const payload = JSON.stringify({ id:'evt_test', object:'event', type:'unhandled.event', livemode:true, data:{object:{}} });
  const signature = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret:'whsec_test_fixture' });
  const response = await handleWebhook(new Request('https://functions.invalid', { method:'POST', body:payload, headers:{'stripe-signature':signature} }));
  assert.equal(response.status,503);
});
Deno.test('anonymous usage reports cannot generate charges', async () => {
  assert.equal((await handleUsage(req({userId:'someone-else',seconds:99999}))).status,401);
});
Deno.test('user-controlled signup metadata cannot grant staff activation', async () => {
  const original = db.auth.getUser;
  // Deliberately untrusted user_metadata contains a forged role.
  db.auth.getUser = (() => Promise.resolve({data:{user:{id:'user',aud:'authenticated',created_at:'2026-09-20T00:00:00Z',app_metadata:{},user_metadata:{billing_admin:true}}},error:null})) as typeof original;
  try { assert.equal((await handleActivation(req({serviceReady:true}, {authorization:'Bearer fixture'}))).status,403); }
  finally { db.auth.getUser = original; }
});
Deno.test('checkout launch is gated until deployment is ready', async () => {
  const original = db.auth.getUser;
  db.auth.getUser = (() => Promise.resolve({data:{user:{id:'user'}},error:null})) as typeof original;
  Deno.env.set('BILLING_ENABLED','false');
  try { assert.equal((await handleBilling(req({action:'checkout'}, {authorization:'Bearer fixture'}))).status,503); }
  finally { db.auth.getUser = original; }
});
