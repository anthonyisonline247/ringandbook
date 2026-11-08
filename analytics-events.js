(() => {
  'use strict';

  const CONSENT_KEY = 'rab-optional-services-consent';
  const MEASUREMENT_ID = 'G-N3M64HSJKR';

  function hasAnalyticsConsent() {
    return window.localStorage.getItem(CONSENT_KEY) === 'accepted';
  }

  function enableAnalytics() {
    if (!hasAnalyticsConsent() || window.rabAnalyticsLoaded) return;
    window.rabAnalyticsLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', MEASUREMENT_ID);

    if (!document.querySelector(`script[data-rab-ga="${MEASUREMENT_ID}"]`)) {
      const script = document.createElement('script');
      script.async = true;
      script.dataset.rabGa = MEASUREMENT_ID;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
      document.head.append(script);
    }
  }

  // Never pass form fields, email addresses, phone numbers, or account IDs to analytics.
  window.rabTrackEvent = (name, values = {}) => {
    if (!hasAnalyticsConsent()) return;
    enableAnalytics();
    window.gtag?.('event', name, values);
  };
  window.rabEnableOptionalAnalytics = enableAnalytics;

  if (hasAnalyticsConsent()) enableAnalytics();

  document.addEventListener('click', event => {
    const target = event.target.closest('a, button');
    if (!target) return;
    const href = target instanceof HTMLAnchorElement ? new URL(target.href, window.location.href) : null;
    const location = target.dataset.trackLocation || target.closest('section')?.id || 'page';

    if (target.dataset.plan) {
      window.rabTrackEvent('select_plan', { plan: target.dataset.plan, cta_location: location });
    } else if (href?.pathname === '/onboarding') {
      window.rabTrackEvent('start_setup_click', { cta_location: location });
    } else if (href?.pathname === '/watch-ai-receptionist-demo') {
      window.rabTrackEvent('watch_demo_click', { cta_location: location });
    }
  });
})();
