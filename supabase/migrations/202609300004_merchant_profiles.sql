-- Merchant-owned business information, separate from billing permissions.
create table public.merchant_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  business_name text not null default '',
  contact_name text not null default '',
  phone text not null default '',
  address text not null default '',
  service_area text not null default '',
  business_hours text not null default '',
  timezone text not null default 'America/Los_Angeles',
  services text not null default '',
  language_preferences text not null default '',
  transfer_phone text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.merchant_profiles enable row level security;
revoke all on public.merchant_profiles from anon, authenticated;
grant select, insert, update on public.merchant_profiles to authenticated;
create policy own_profile_read on public.merchant_profiles for select to authenticated using (user_id = auth.uid());
create policy own_profile_insert on public.merchant_profiles for insert to authenticated with check (user_id = auth.uid());
create policy own_profile_update on public.merchant_profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
