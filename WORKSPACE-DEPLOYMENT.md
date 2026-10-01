# Merchant workspace deployment

Deploy database and function changes before publishing the frontend.

1. Apply `supabase/migrations/202609300004_merchant_profiles.sql` to the intended Supabase project. It creates an owner-only profile table without changing billing permissions.
2. Deploy the updated `billing` function. Its new `usage` action uses the authenticated user ID. The existing STRIPE_MODE determines test versus live usage tables.
3. Publish `index.html`, `account.html`, `account.js`, `account-billing.js`, `account.css`, `workspace.css`, and `workspace.js` together.
4. With two authorized test accounts, verify profile save/reload and cross-account read/write rejection. Test a current usage cycle, absent usage, expired sessions, failed saves, mobile layout and existing billing actions. Do not submit demo forms or initiate payments without authorization.

Preferences are stored for onboarding; they do not automatically change Vapi configuration or notify staff. There is no staff processing queue yet. Call recordings, transcripts, summaries and appointments are not connected: these require authenticated provider integrations and verified user-to-agent/calendar mappings. The interface explicitly describes these limitations and shows errors instead of false success when backend changes have not been deployed.

The account button and login flow navigate to `/account.html` (Cloudflare Pages may canonicalize this to `/account`). This is an independent page, not a modal or iframe. Section hashes support refresh and back/forward navigation. Existing Stripe returns to the homepage are forwarded to the account page, where verified billing state is fetched.

Personal display names are stored in Supabase user metadata. Password changes require the current email/password to be verified first; users signing in only with Google are directed to manage their password with Google. No schema migration is required for these account settings. The page is noindex and shows a sign-in gate before displaying account information.
