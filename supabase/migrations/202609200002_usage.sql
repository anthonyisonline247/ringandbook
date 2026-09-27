create table public.billing_usage_cycles (
  user_id uuid not null references public.billing_accounts(user_id),
  period_start timestamptz not null,
  period_end timestamptz not null,
  seconds bigint not null default 0 check(seconds >= 0),
  primary key(user_id, period_start)
);
create table public.billing_usage_calls (
  call_id text primary key,
  user_id uuid not null references public.billing_accounts(user_id),
  seconds integer not null check(seconds between 0 and 86400),
  ended_at timestamptz not null,
  period_start timestamptz not null,
  billable_minutes integer not null,
  event_id uuid not null default gen_random_uuid() unique,
  first_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.billing_usage_cycles enable row level security;
alter table public.billing_usage_calls enable row level security;
revoke all on public.billing_usage_cycles, public.billing_usage_calls from anon, authenticated;
grant all on public.billing_usage_cycles, public.billing_usage_calls to service_role;

create function public.record_billing_call(p_user_id uuid, p_call_id text, p_seconds integer,
  p_ended_at timestamptz, p_period_start timestamptz, p_period_end timestamptz, p_free_trial boolean)
returns public.billing_usage_calls
language plpgsql security definer set search_path = '' as $$
declare old_call public.billing_usage_calls; result public.billing_usage_calls;
  old_seconds bigint; allowance integer; extra integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into old_call from public.billing_usage_calls where call_id = p_call_id;
  if found then
    if old_call.user_id <> p_user_id or old_call.seconds <> p_seconds or old_call.ended_at <> p_ended_at then
      raise exception 'Conflicting duplicate call';
    end if;
    return old_call;
  end if;
  if p_seconds < 0 or p_seconds > 86400 or p_ended_at < p_period_start or p_ended_at >= p_period_end then
    raise exception 'Invalid call period or duration';
  end if;
  select case when plan = 'starter' then 250 else 700 end into strict allowance
    from public.billing_accounts where user_id = p_user_id;
  insert into public.billing_usage_cycles(user_id, period_start, period_end)
    values(p_user_id, p_period_start, p_period_end) on conflict do nothing;
  select seconds into old_seconds from public.billing_usage_cycles
    where user_id = p_user_id and period_start = p_period_start for update;
  extra := case when p_free_trial then 0 else
    greatest(0, ceil((old_seconds + p_seconds)::numeric / 60)::integer - allowance)
    - greatest(0, ceil(old_seconds::numeric / 60)::integer - allowance) end;
  update public.billing_usage_cycles set seconds = seconds + p_seconds
    where user_id = p_user_id and period_start = p_period_start;
  insert into public.billing_usage_calls(call_id, user_id, seconds, ended_at, period_start, billable_minutes, delivered_at)
    values(p_call_id, p_user_id, p_seconds, p_ended_at, p_period_start, extra, case when extra = 0 then now() else null end)
    returning * into result;
  return result;
end;
$$;
revoke all on function public.record_billing_call(uuid,text,integer,timestamptz,timestamptz,timestamptz,boolean) from public, anon, authenticated;
grant execute on function public.record_billing_call(uuid,text,integer,timestamptz,timestamptz,timestamptz,boolean) to service_role;
