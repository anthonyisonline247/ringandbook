const CLIENT_CONFIG = {
  supabaseUrl: 'https://gwzabzztchktjxrbqzzc.supabase.co',
  supabaseAnonKey: 'sb_publishable_0JBNUQeJOKXoKnVNKM8ucw_pF9E-SoX',
};
const fields = ['business_name','contact_name','phone','address','service_area','timezone','services','business_hours','language_preferences','transfer_phone','onboarding_notes'];
const labels = { business_name:'Business name', contact_name:'Contact name', phone:'Business phone', address:'Business address', service_area:'Service area', timezone:'Time zone', services:'Services', business_hours:'Business hours', language_preferences:'Languages', transfer_phone:'Emergency transfer', onboarding_notes:'Additional notes' };
let client, user, step = 1;
const form = document.getElementById('onboarding-form');
const status = document.getElementById('onboarding-status');
function setStatus(message, error = false) { status.textContent = message; status.style.color = error ? '#b42332' : '#526379'; }
function values() { return Object.fromEntries(fields.map(name => [name, form.elements.namedItem(name).value.trim()])); }
function showStep(next) {
  step = next;
  document.querySelectorAll('.form-step').forEach(panel => { panel.hidden = Number(panel.dataset.step) !== step; });
  document.querySelectorAll('.progress-step').forEach(item => item.classList.toggle('active', Number(item.dataset.progress) <= step));
  document.getElementById('back-button').hidden = step === 1;
  document.getElementById('next-button').hidden = step === 3;
  document.getElementById('submit-button').hidden = step !== 3;
  if (step === 3) renderReview();
  setStatus('');
  document.querySelector(`[data-step="${step}"] h2`)?.focus?.();
}
function validateCurrent() {
  const panel = document.querySelector(`[data-step="${step}"]`);
  const inputs = [...panel.querySelectorAll('input[required],textarea[required]')];
  for (const input of inputs) if (!input.reportValidity()) return false;
  if (step === 1) { try { new Intl.DateTimeFormat('en-US',{timeZone:form.elements.timezone.value.trim()}); } catch { setStatus('Enter a valid time zone, for example America/Los_Angeles.', true); return false; } }
  return true;
}
function renderReview() {
  const current = values();
  const review = document.getElementById('review-details'); review.replaceChildren();
  fields.filter(name => current[name]).forEach(name => { const row=document.createElement('div'), key=document.createElement('b'), value=document.createElement('span'); key.textContent=labels[name]; value.textContent=current[name]; row.append(key,value); review.append(row); });
}
document.getElementById('next-button').addEventListener('click', () => { if (validateCurrent()) showStep(step + 1); });
document.getElementById('back-button').addEventListener('click', () => showStep(step - 1));
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!validateCurrent() || !document.getElementById('setup-acknowledgement').checked || !user) { if (!document.getElementById('setup-acknowledgement').checked) setStatus('Please confirm that our team will configure your receptionist before it goes live.', true); return; }
  const button = document.getElementById('submit-button'); button.disabled = true; setStatus('Sending your setup request…');
  try {
    const profile = { ...values(), user_id:user.id, onboarding_submitted_at:new Date().toISOString(), updated_at:new Date().toISOString() };
    const { error } = await client.from('merchant_profiles').upsert(profile);
    if (error) throw error;
    form.hidden = true; document.querySelector('.progress').hidden = true; document.querySelector('.intro').hidden = true; document.getElementById('complete-panel').hidden = false;
  } catch { setStatus('We could not save your request. Please try again and keep this page open.', true); button.disabled = false; }
});
async function boot() {
  try {
    client = supabase.createClient(CLIENT_CONFIG.supabaseUrl, CLIENT_CONFIG.supabaseAnonKey);
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) { location.replace('/?trial=1'); return; }
    user = data.user;
    const { data: profile, error: profileError } = await client.from('merchant_profiles').select([...fields,'onboarding_submitted_at'].join(',')).eq('user_id',user.id).maybeSingle();
    if (profileError) throw profileError;
    fields.forEach(name => { form.elements.namedItem(name).value = profile?.[name] ?? (name === 'contact_name' ? (user.user_metadata?.full_name || '') : name === 'timezone' ? 'America/Los_Angeles' : ''); });
    document.getElementById('onboarding-gate').hidden = true; document.getElementById('onboarding-shell').hidden = false;
    if (profile?.onboarding_submitted_at) { form.hidden = true; document.querySelector('.progress').hidden = true; document.querySelector('.intro').hidden = true; document.getElementById('complete-panel').hidden = false; }
  } catch { document.getElementById('onboarding-gate').textContent = 'We could not open onboarding. Please refresh or contact support.'; }
}
boot();
