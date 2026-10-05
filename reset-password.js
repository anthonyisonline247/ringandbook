(() => {
  const config = {
    supabaseUrl: 'https://gwzabzztchktjxrbqzzc.supabase.co',
    supabaseAnonKey: 'sb_publishable_0JBNUQeJOKXoKnVNKM8ucw_pF9E-SoX'
  };
  const status = document.getElementById('reset-status');
  const form = document.getElementById('reset-form');
  const submit = document.getElementById('reset-submit');
  let recoverySessionReady = false;

  function showStatus(message, color = '#526379') {
    status.textContent = message;
    status.style.color = color;
  }
  function showForm() {
    recoverySessionReady = true;
    form.hidden = false;
    showStatus('Your reset link is verified. Choose a new password below.', '#14734b');
    document.getElementById('new-password').focus();
  }

  if (!window.supabase) {
    showStatus('Password reset is temporarily unavailable. Please return to login and try again.', '#b42332');
    return;
  }
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) showForm();
  });

  window.setTimeout(() => {
    if (!recoverySessionReady) {
      showStatus('This password reset link is invalid or has expired. Request a new link from the login screen.', '#92400e');
    }
  }, 1800);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!recoverySessionReady) return;
    const password = document.getElementById('new-password').value;
    const confirmation = document.getElementById('confirm-password').value;
    if (password.length < 12) { showStatus('Use at least 12 characters for your new password.', '#b42332'); return; }
    if (password !== confirmation) { showStatus('The two password entries do not match.', '#b42332'); return; }
    submit.disabled = true;
    submit.textContent = 'Updating password…';
    const { error } = await client.auth.updateUser({ password });
    if (error) {
      showStatus(error.message, '#b42332');
      submit.disabled = false;
      submit.textContent = 'Update password';
      return;
    }
    await client.auth.signOut({ scope: 'local' });
    form.hidden = true;
    showStatus('Your password has been updated. Redirecting you to sign in…', '#14734b');
    window.setTimeout(() => { window.location.assign('/?login=1'); }, 1000);
  });
})();
