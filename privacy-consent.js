(() => {
  'use strict';

  const CONSENT_KEY = 'rab-optional-services-consent';
  const bannerId = 'rab-privacy-banner';

  function showBanner() {
    const banner = document.getElementById(bannerId);
    if (banner) banner.hidden = false;
  }

  function choose(choice) {
    window.localStorage.setItem(CONSENT_KEY, choice);
    const banner = document.getElementById(bannerId);
    if (banner) banner.hidden = true;
    if (choice === 'accepted') window.rabEnableOptionalAnalytics?.();
  }

  function createPrivacyControls() {
    if (document.getElementById(bannerId)) return;
    document.body.insertAdjacentHTML('beforeend', `
      <aside class="rab-privacy-banner" id="${bannerId}" aria-label="Privacy choices" hidden>
        <div><strong>Privacy choices</strong><p>Essential tools run the site. Optional analytics load only if you allow them. <a href="/privacy">Privacy Policy</a></p></div>
        <div class="rab-privacy-actions"><button type="button" data-rab-choice="essential">Use essential only</button><button type="button" class="rab-privacy-accept" data-rab-choice="accepted">Allow analytics</button></div>
      </aside>
      <button type="button" class="rab-privacy-fab" id="rab-privacy-choices" aria-label="Open privacy choices">Privacy choices</button>
    `);
    document.querySelectorAll('[data-rab-choice]').forEach(button => button.addEventListener('click', () => choose(button.dataset.rabChoice)));
    document.getElementById('rab-privacy-choices').addEventListener('click', showBanner);
  }

  createPrivacyControls();
  if (!window.localStorage.getItem(CONSENT_KEY)) showBanner();
})();
