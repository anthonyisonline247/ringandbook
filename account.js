let currentUser = null;
function setStatus(id, message, color = '#526379') {
  const el = document.getElementById(id); el.style.display = 'block'; el.style.color = color; el.textContent = message;
}
function showIdentity(user) {
  currentUser = user;
  if (typeof resetBillingView === 'function') resetBillingView();
  window.dispatchEvent(new CustomEvent('workspace-user', {detail:user.id}));
  const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Your account';
  document.getElementById('account-title').textContent = `Welcome, ${name}`;
  document.getElementById('account-email').textContent = user.email || '';
  document.getElementById('account-display-name').textContent = name;
  document.getElementById('personal-name').value = name;
  document.getElementById('personal-email').value = user.email || '';
  const hasPassword = user.identities?.some(identity => identity.provider === 'email');
  document.getElementById('password-form').hidden = !hasPassword;
  document.getElementById('password-help').textContent = hasPassword ? 'Confirm your current password to choose a new one.' : 'You sign in with an external provider such as Google. Manage that password in your provider account.';
}
function lockAccount() {
  currentUser = null; ++billingRefreshVersion;
  window.dispatchEvent(new CustomEvent('workspace-user', {detail:null}));
  document.getElementById('account-shell').hidden = true;
  document.querySelectorAll('form').forEach(form => form.reset());
  document.getElementById('session-gate').hidden = false;
  document.getElementById('session-gate').replaceChildren();
  const link = document.createElement('a'); link.href = '/?login=1'; link.textContent = 'Sign in to open your workspace';
  document.getElementById('session-gate').append(link);
}
async function bootAccount() {
  try {
    client = supabase.createClient(CLIENT_CONFIG.supabaseUrl, CLIENT_CONFIG.supabaseAnonKey);
    const {data,error} = await client.auth.getUser();
    if (error || !data.user) { lockAccount(); return; }
    showIdentity(data.user);
    document.getElementById('session-gate').hidden = true;
    document.getElementById('account-shell').hidden = false;
    window.dispatchEvent(new Event('workspace-open'));
    refreshBilling();
    if (new URLSearchParams(location.search).has('billing')) {
      setStatus('account-status','Checking your subscription with the billing service…');
      const url = new URL(location.href); url.searchParams.delete('billing'); history.replaceState(null,'',url);
    }
    client.auth.onAuthStateChange((event,session) => {
      if (event === 'SIGNED_OUT' || !session) lockAccount();
      else if (currentUser && currentUser.id !== session.user.id) {
        // Never leave the previous customer's workspace visible while an OAuth
        // session is being replaced. Reload under the new, verified identity.
        lockAccount();
        location.replace('/account.html');
      }
    });
  } catch {
    document.getElementById('session-gate').textContent = 'Unable to load your account. Please refresh this page to retry.';
  }
}
document.getElementById('choose-plan-button').addEventListener('click',()=>location.assign('/#pricing'));
document.getElementById('signout-button').addEventListener('click',async()=>{
  const {error} = await client.auth.signOut();
  if (error) { setStatus('account-status','Sign out failed. Please retry.'); return; }
  location.assign('/');
});
document.getElementById('personal-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const name = document.getElementById('personal-name').value.trim();
  if (!name || !currentUser) return;
  const button=event.currentTarget.querySelector('button'); button.disabled=true;
  try {
    const {data,error}=await client.auth.updateUser({data:{full_name:name}});
    if(error) throw error;
    if (!currentUser || data.user.id !== currentUser.id) return;
    showIdentity(data.user); setStatus('personal-status','Profile saved.');
  } catch { setStatus('personal-status','Unable to save your profile. Please retry.'); }
  finally {button.disabled=false;}
});
document.getElementById('password-form').addEventListener('submit',async event=>{
  event.preventDefault(); if(!currentUser) return;
  const form=event.currentTarget, button=form.querySelector('button');
  const password=document.getElementById('new-password').value;
  if(password!==document.getElementById('confirm-password').value){setStatus('password-status','The new passwords do not match.');return;}
  if(password.length<12){setStatus('password-status','Use at least 12 characters.');return;}
  button.disabled=true;
  try {
    const userId=currentUser.id;
    const verified=await client.auth.signInWithPassword({email:currentUser.email,password:document.getElementById('current-password').value});
    if(verified.error || verified.data.user?.id!==userId){setStatus('password-status','Your current password could not be verified.');return;}
    const {error}=await client.auth.updateUser({password});
    if(error){setStatus('password-status',error.message);return;}
    form.reset();
    const signedOut=await client.auth.signOut({scope:'local'});
    if(signedOut.error){setStatus('password-status','Password updated. Please log out and sign in again.');return;}
    location.assign('/?login=1');
  } catch {setStatus('password-status','Unable to update your password. Please retry.');}
  finally {button.disabled=false;}
});
bootAccount();
