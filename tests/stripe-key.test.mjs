import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validStripeKey } from '../supabase/functions/_shared/stripe-key.mjs';
test('accept full and restricted keys only in their intended mode', () => {
  for (const mode of ['test','live']) for (const prefix of ['sk','rk']) {
    assert.equal(validStripeKey(`${prefix}_${mode}_fixture`, mode), true);
    assert.equal(validStripeKey(`${prefix}_${mode}_fixture`, mode === 'test' ? 'live' : 'test'), false);
  }
  for (const key of [undefined, '', 'pk_live_fixture', 'rk_live_', 'other']) assert.equal(validStripeKey(key,'live'),false);
  assert.equal(validStripeKey('rk_live_fixture','other'),false);
});
