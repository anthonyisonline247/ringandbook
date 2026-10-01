(() => {
  const form = document.getElementById('merchant-profile-form');
  const fields = document.getElementById('merchant-profile-fields');
  const status = document.getElementById('merchant-profile-status');
  const usage = document.getElementById('workspace-usage');
  const detail = document.getElementById('workspace-usage-detail');
  const names = [...form.querySelectorAll('[name]')].map(input => input.name);
  let generation = 0;
  let owner = null;
  function reset() {
    generation++;
    owner = null;
    form.reset(); fields.disabled = true; status.textContent = '';
    usage.textContent = 'Loading usage…'; detail.textContent = '';
  }
  function selectSection(name) {
    if (!document.getElementById(`workspace-${name}`)) name = 'overview';
    document.querySelectorAll('[data-workspace]').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.workspace === name)));
    document.querySelectorAll('.workspace-panel').forEach(panel => { panel.hidden = panel.id !== `workspace-${name}`; });
  }
  window.addEventListener('hashchange', () => selectSection(location.hash.slice(1)));
  selectSection(location.hash.slice(1));
  document.querySelectorAll('[data-workspace]').forEach(button => {
    button.addEventListener('click', () => {
      location.hash = button.dataset.workspace;
      selectSection(button.dataset.workspace);
    });
  });
  async function load() {
    reset();
    const version = generation;
    status.textContent = 'Loading your business details…';
    try {
      if (!client) throw new Error('unavailable');
      const { data, error } = await client.auth.getUser();
      if (version !== generation) return;
      if (error || !data.user) throw new Error('unauthenticated');
      owner = data.user.id;
      // Billing failures must not prevent business profile access.
      billingRequest({ action: 'usage' }).then(info => {
        if (version !== generation) return;
        if (!info.cycle) {
          usage.textContent = 'No current usage record';
          detail.textContent = 'Usage will appear when calls are reported for your current billing cycle.';
          return;
        }
        const minutes = Math.ceil(Number(info.cycle.seconds) / 60);
        usage.textContent = `${minutes} / ${info.allowance} included minutes`;
        detail.textContent = `${new Date(info.cycle.period_start).toLocaleDateString()} – ${new Date(info.cycle.period_end).toLocaleDateString()} · ${Math.max(0, info.allowance - minutes)} minutes remaining. Extra minutes: $0.35/min; trial usage follows your trial terms.`;
      }).catch(() => {
        if (version === generation) { usage.textContent = 'Usage temporarily unavailable'; detail.textContent = 'Please reopen your workspace to retry. This does not mean your usage is zero.'; }
      });
      const result = await client.from('merchant_profiles').select(names.join(',')).eq('user_id', owner).maybeSingle();
      if (version !== generation) return;
      if (result.error) throw result.error;
      names.forEach(name => { form.elements.namedItem(name).value = result.data?.[name] ?? (name === 'timezone' ? 'America/Los_Angeles' : ''); });
      fields.disabled = false;
      status.textContent = result.data ? 'Your saved business details.' : 'Add your business details to help us prepare your receptionist.';
    } catch {
      if (version === generation) { fields.disabled = true; status.textContent = 'Business details could not be loaded. Please retry or contact support.'; }
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (fields.disabled || !owner || !form.reportValidity()) return;
    const version = generation;
    const userId = owner;
    const values = Object.fromEntries(names.map(name => [name, form.elements.namedItem(name).value.trim()]));
    try { new Intl.DateTimeFormat('en-US', { timeZone: values.timezone }); }
    catch { status.textContent = 'Enter a valid time zone, for example America/Los_Angeles.'; return; }
    if (!values.business_name || !values.contact_name) { status.textContent = 'Business and contact names are required.'; return; }
    fields.disabled = true; status.textContent = 'Saving…';
    try {
      const { data, error } = await client.auth.getUser();
      if (version !== generation) return;
      if (error || data.user?.id !== userId) throw new Error('session changed');
      const result = await client.from('merchant_profiles').upsert({ ...values, user_id: userId, updated_at: new Date().toISOString() });
      if (result.error) throw result.error;
      if (version === generation) status.textContent = 'Business details saved. Contact our team to apply changes to your live receptionist.';
    } catch {
      if (version === generation) status.textContent = 'Your changes could not be saved. Please retry; keep this page open to retain your entries.';
    } finally { if (version === generation) fields.disabled = false; }
  });
  window.addEventListener('workspace-open', load);
  window.addEventListener('workspace-user', event => { if (event.detail !== owner) reset(); });
  document.getElementById('reload-workspace').addEventListener('click', load);
  if (document.getElementById('account-modal')?.classList.contains('open')) load();
})();
