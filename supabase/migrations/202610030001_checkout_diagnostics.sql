-- Server-only provider diagnostics for failed Checkout Session creation.
-- This intentionally excludes provider messages, customer data, and any payment data.
alter table public.billing_accounts
  add column if not exists last_checkout_error jsonb;

alter table public.billing_test_accounts
  add column if not exists last_checkout_error jsonb;
