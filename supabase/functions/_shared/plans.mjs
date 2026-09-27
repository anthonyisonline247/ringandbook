export const PLANS = Object.freeze({
  starter: { name: 'Starter', minutes: 250, monthly: 8900, annually: 97900 },
  growth: { name: 'Growth', minutes: 700, monthly: 18900, annually: 207900 },
});
export const TRIAL_DAYS = 7;
export function selectPlan(plan, period) {
  if (!Object.hasOwn(PLANS, plan) || !['monthly', 'annually'].includes(period)) {
    throw new Error('Invalid plan or billing period');
  }
  return { ...PLANS[plan], amount: PLANS[plan][period], plan, period };
}
export function billingConsent(plan, period) {
  const p = selectPlan(plan, period);
  const cost = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(p.amount / 100);
  return `No charge today. Your 7-day free trial starts when your phone service goes live. Then ${cost}/${period === 'monthly' ? 'month' : 'year'} renews automatically until canceled. Includes ${p.minutes} minutes per month; additional minutes cost $0.35 each, billed monthly. Cancel before the trial ends to avoid the subscription charge.`;
}
export function overageMinutes(seconds, included) {
  if (!Number.isSafeInteger(seconds) || seconds < 0 || !Number.isSafeInteger(included) || included < 0) throw new Error('Invalid usage');
  return Math.max(0, Math.ceil(seconds / 60) - included);
}
export function publicAccount(row) {
  if (!row) return { status: 'not_started' };
  return {
    status: row.status, plan: row.plan, period: row.period,
    trialEnd: row.trial_end, cancelAtPeriodEnd: row.cancel_at_period_end,
    canManage: Boolean(row.stripe_customer_id),
  };
}
