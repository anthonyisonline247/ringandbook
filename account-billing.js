const CLIENT_CONFIG = {
  supabaseUrl: 'https://gwzabzztchktjxrbqzzc.supabase.co',
  supabaseAnonKey: 'sb_publishable_0JBNUQeJOKXoKnVNKM8ucw_pF9E-SoX'
};
let client = null;
async function billingRequest(payload) {
  if (!client) throw new Error('Account service is unavailable. Please try again shortly.');
  const { data, error } = await client.functions.invoke('billing', { body: payload });
  if (error) {
    let message = 'Billing is temporarily unavailable. Please try again shortly.';
    if (error.context instanceof Response) {
      const detail = await error.context.json().catch(() => null);
      if (typeof detail?.error === 'string') message = detail.error;
    }
    throw new Error(message);
  }
  return data;
}
let billingRefreshVersion = 0;
async function refreshBilling() {
  const version = ++billingRefreshVersion;
  try {
    const info = await billingRequest({ action: 'status' });
    if (version !== billingRefreshVersion) return;
    const labels = { not_started: 'No subscription yet', awaiting_payment_method: 'Payment method needed', pending_setup: 'Preparing your phone service', starting: 'Starting your trial', trialing: '7-day free trial', active: 'Active', canceled: 'Canceled', past_due: 'Payment needs attention', unpaid: 'Payment needed', paused: 'Paused', incomplete: 'Payment setup incomplete', incomplete_expired: 'Payment setup expired' };
    document.getElementById('subscription-status').textContent = labels[info.status] || 'Contact support';
    document.getElementById('subscription-detail').textContent = info.status === 'pending_setup' ? 'Payment method saved. No charge today. We will contact you to finish setup; your trial begins when your phone service goes live.' : info.status === 'trialing' && info.trialEnd ? `Trial ends ${new Date(info.trialEnd).toLocaleDateString()}. ${info.cancelAtPeriodEnd ? 'Cancellation is scheduled.' : 'Your selected plan renews automatically afterward.'}` : info.cancelAtPeriodEnd ? 'Your subscription is scheduled to cancel at the end of its current period.' : info.plan ? `${info.plan === 'starter' ? 'Starter' : 'Growth'} · ${info.period === 'annually' ? 'Annual billing' : 'Monthly billing'}` : 'Choose a plan. Your 7-day trial starts when your phone service is live.';
    document.getElementById('manage-subscription-button').disabled = !info.canManage;
    document.getElementById('cancel-setup-button').hidden = !['awaiting_payment_method', 'pending_setup'].includes(info.status);
    return info;
  } catch (error) {
    if (version === billingRefreshVersion) {
      document.getElementById('subscription-status').textContent = 'Status temporarily unavailable';
      document.getElementById('subscription-detail').textContent = error.message;
    }
  }
}
document.getElementById('manage-subscription-button').addEventListener('click', async () => {
  const button = document.getElementById('manage-subscription-button'); button.disabled = true;
  try {
    const data = await billingRequest({ action: 'portal' });
    if (!data?.url || new URL(data.url).hostname !== 'billing.stripe.com') throw new Error('Unable to open billing management.');
    window.location.assign(data.url);
  } catch (error) { setStatus('account-status', error.message, '#92400e'); }
  finally { button.disabled = false; }
});
document.getElementById('cancel-setup-button').addEventListener('click', async () => {
  if (!confirm('Cancel your setup request? Your phone service and free trial will not be activated.')) return;
  const button = document.getElementById('cancel-setup-button'); button.disabled = true;
  try { await billingRequest({ action: 'cancel_setup' }); await refreshBilling(); }
  catch (error) { setStatus('account-status', error.message, '#92400e'); }
  finally { button.disabled = false; }
});
