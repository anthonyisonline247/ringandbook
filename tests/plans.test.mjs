import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { selectPlan, billingConsent, overageMinutes } from '../supabase/functions/_shared/plans.mjs';
test('advertised monthly and annual prices match server configuration', () => {
  for (const [plan, period, amount] of [['starter','monthly',8900],['starter','annually',97900],['growth','monthly',18900],['growth','annually',207900]]) assert.equal(selectPlan(plan, period).amount, amount);
  for (const plan of ['enterprise','__proto__','toString']) assert.throws(() => selectPlan(plan, 'monthly'));
  assert.throws(() => selectPlan('starter','weekly'));
});
test('consent explains delayed trial, renewal, allowance and monthly overage', () => {
  const text = billingConsent('growth', 'annually');
  for (const phrase of ['$2,079/year', '7-day', 'phone service goes live', '700 minutes', '$0.35', 'billed monthly', 'Cancel']) assert.ok(text.includes(phrase));
});
test('monthly total rounding and included-minute boundaries', () => {
  assert.equal(overageMinutes(0,250),0);
  assert.equal(overageMinutes(15000,250),0);
  assert.equal(overageMinutes(15001,250),1);
  assert.equal(overageMinutes(15060,250),1);
  assert.equal(overageMinutes(15061,250),2);
  assert.equal(overageMinutes(42000,700),0);
  assert.equal(overageMinutes(42001,700),1);
  assert.throws(() => overageMinutes(-1,250));
});
test('all inline scripts parse and checkout respects all four prices', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url),'utf8');
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    if (!match[0].includes('application/ld+json')) new vm.Script(match[1]);
  }
  const source = html.match(/function showCheckout\(plan\) \{[\s\S]*?\n\}/)[0];
  for (const [plan, annual, expected] of [['starter',false,'$89/mo'],['growth',false,'$189/mo'],['starter',true,'$979/year'],['growth',true,'$2,079/year']]) {
    const elements={}; const ctx={document:{getElementById(id){return elements[id] ||= {style:{},getAttribute(){return String(annual)}};}},openModal(){}};
    vm.createContext(ctx); vm.runInContext(source+`;showCheckout('${plan}')`,ctx);
    assert.equal(elements['checkout-plan-price'].textContent, expected);
    assert.equal(elements['billing-consent'].checked, false);
    assert.ok(elements['billing-terms'].textContent.includes(expected));
  }
});
