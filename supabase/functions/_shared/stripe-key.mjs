// Restricted keys retain least-privilege permissions; never require a full key.
export function validStripeKey(key, mode) {
  return ['test', 'live'].includes(mode) && typeof key === 'string'
    && new RegExp(`^(sk|rk)_${mode}_.+`).test(key);
}
