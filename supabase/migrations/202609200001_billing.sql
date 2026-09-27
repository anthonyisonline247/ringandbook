create table public.billing_accounts (
  user_id uuid primary key references auth.users(id),
  plan text not null check (plan in ('starter', 'growth')),
  period text not null check (period in ('monthly', 'annually')),
  status text not null default 'awaiting_payment_method',
  stripe_customer_id text unique,
  stripe_setup_session_id text,
  stripe_payment_method_id text,
  stripe_subscription_id text unique,
  checkout_generation uuid not null default gen_random_uuid(),
  consent_version text not null default '2026-09-20-v1',
  consent_at timestamptz not null default now(),
  trial_end timestamptz,
  activated_at timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.billing_accounts enable row level security;
-- All billing reads/writes go through authenticated server functions. Browser
-- users cannot assign themselves plans, payment methods, trials or subscriptions.
revoke all on public.billing_accounts from anon, authenticated;
grant all on public.billing_accounts to service_role;

create table public.billing_operations (
  user_id uuid primary key references public.billing_accounts(user_id),
  token uuid not null,
  expires_at timestamptz not null
);
alter table public.billing_operations enable row level security;
revoke all on public.billing_operations from anon, authenticated;
grant all on public.billing_operations to service_role;

create function public.lock_billing(p_user_id uuid, p_token uuid) returns boolean
language sql security definer set search_path = '' as $$
  with acquired as (
    insert into public.billing_operations values (p_user_id, p_token, now() + interval '2 minutes')
    on conflict (user_id) do update set token = excluded.token, expires_at = excluded.expires_at
      where public.billing_operations.expires_at < now()
    returning 1
  ) select exists(select 1 from acquired);
$$;
revoke all on function public.lock_billing(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lock_billing(uuid, uuid) to service_role;
