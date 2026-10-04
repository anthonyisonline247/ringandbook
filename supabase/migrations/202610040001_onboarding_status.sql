-- Tracks a merchant's submitted setup brief. It is not a subscription or a
-- service activation flag: the team still reviews and configures every agent.
alter table public.merchant_profiles
  add column if not exists onboarding_notes text not null default '',
  add column if not exists onboarding_submitted_at timestamptz;
