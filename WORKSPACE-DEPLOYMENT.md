# Merchant workspace deployment

Deploy database and function changes before publishing the frontend.

1. Apply `supabase/migrations/202609300004_merchant_profiles.sql` to the intended Supabase project. It creates an owner-only profile table without changing billing permissions.
2. Deploy the updated `billing` function. Its new `usage` action uses the authenticated user ID. The existing STRIPE_MODE determines test versus live usage tables.
3. Publish `index.html`, `workspace.css`, and `workspace.js` together.
4. With two authorized test accounts, verify profile save/reload and cross-account read/write rejection. Test a current usage cycle, absent usage, expired sessions, failed saves, mobile layout and existing billing actions. Do not submit demo forms or initiate payments without authorization.

Preferences are stored for onboarding; they do not automatically change Vapi configuration or notify staff. There is no staff processing queue yet. Call recordings, transcripts, summaries and appointments are not connected: these require authenticated provider integrations and verified user-to-agent/calendar mappings. The interface explicitly describes these limitations and shows errors instead of false success when backend changes have not been deployed.

The workspace opens from the existing account button and login flow. It retains the existing billing return URLs rather than introducing a separate routed application.
