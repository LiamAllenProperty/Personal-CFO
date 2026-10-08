-- Classification, pay-period maths, allowance status, points and spend notifications.

-- ---------------------------------------------------------------------------
-- Classification
-- ---------------------------------------------------------------------------
create function public.classify_transaction(
  p_user uuid,
  p_amount numeric,
  p_description text,
  p_merchant text,
  p_provider_category text,
  p_account_type text
) returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_text text := lower(coalesce(p_description, '') || ' ' || coalesce(p_merchant, ''));
  v_kind text;
begin
  -- 1. The user's own rules win
  select r.kind into v_kind
  from public.category_rules r
  where r.user_id = p_user and v_text like '%' || lower(r.pattern) || '%'
  order by length(r.pattern) desc
  limit 1;
  if v_kind is not null then
    return v_kind;
  end if;

  -- 2. Movements inside savings / investment accounts are counted on the current-account side
  if p_account_type in ('savings', 'investment') then
    return 'transfer';
  end if;

  -- 3. Money in
  if p_amount > 0 then
    if v_text ~ '(salary|wages|payroll|pension payment|dividend|hmrc|interest)' then
      return 'income';
    end if;
    if v_text ~ '(refund|reversal|cashback)' then
      return 'spending'; -- a positive "spending" row reduces the amount spent
    end if;
    if p_account_type = 'credit_card' or upper(coalesce(p_provider_category, '')) = 'TRANSFER'
       or v_text ~ '(transfer from|from savings|tfr from)' then
      return 'transfer';
    end if;
    return 'income';
  end if;

  -- 4. Money out: investing beats saving beats bills beats spending
  if v_text ~ '(vanguard|trading ?212|hargreaves|aj bell|freetrade|nutmeg|moneybox invest|etoro|fidelity|wealthify|interactive investor|lightyear|invest|stocks ?(and|&) ?shares|s&s isa|\msipp\M)' then
    return 'investment';
  end if;
  if v_text ~ '(savings|\msaver\M|save the change|round ?up|\mpot\M|\misa\M|premium bonds|ns&i|to savings)' then
    return 'saving';
  end if;
  if v_text ~ '(credit card payment|card repayment|amex|barclaycard|transfer to own|to own account)' then
    return 'transfer';
  end if;
  if upper(coalesce(p_provider_category, '')) = 'DIRECT_DEBIT' then
    return 'direct_debit';
  end if;
  if upper(coalesce(p_provider_category, '')) = 'STANDING_ORDER' then
    return 'standing_order';
  end if;
  return 'spending';
end;
$$;

create function public.transactions_set_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_account_type text;
begin
  if new.kind is null or not new.kind_locked then
    select a.account_type into v_account_type from public.accounts a where a.id = new.account_id;
    new.kind := public.classify_transaction(
      new.user_id, new.amount, new.description, new.merchant, new.provider_category, v_account_type
    );
  end if;
  return new;
end;
$$;

create trigger transactions_set_kind
  before insert on public.transactions
  for each row execute function public.transactions_set_kind();

-- Re-run classification over a user's unlocked transactions (after adding a rule)
create function public.reclassify_my_transactions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.transactions t
  set kind = public.classify_transaction(t.user_id, t.amount, t.description, t.merchant, t.provider_category, a.account_type)
  from public.accounts a
  where a.id = t.account_id and t.user_id = auth.uid() and not t.kind_locked;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pay periods
-- ---------------------------------------------------------------------------
create function public.pay_period(p_payday integer, p_on date)
returns table (period_start date, period_end date)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_on)::date;
  v_start date;
  v_next date;
begin
  v_start := v_month + (least(p_payday, extract(day from (v_month + interval '1 month - 1 day'))::int) - 1);
  if v_start > p_on then
    v_month := (v_month - interval '1 month')::date;
    v_start := v_month + (least(p_payday, extract(day from (v_month + interval '1 month - 1 day'))::int) - 1);
  end if;
  v_month := (v_month + interval '1 month')::date;
  v_next := v_month + (least(p_payday, extract(day from (v_month + interval '1 month - 1 day'))::int) - 1);
  period_start := v_start;
  period_end := v_next - 1;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Allowance status ("how much cash is left in my wallet")
-- ---------------------------------------------------------------------------
create function public._allowance_for(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_start date;
  v_end date;
  v_spent numeric;
  v_income numeric;
  v_bills_due numeric;
  v_allowance numeric;
  v_remaining numeric;
  v_days_left integer;
begin
  select * into v_profile from public.profiles where id = p_user;
  if not found then
    return null;
  end if;

  select pp.period_start, pp.period_end into v_start, v_end from public.pay_period(v_profile.payday, v_today) pp;

  select coalesce(sum(-t.amount), 0) into v_spent
  from public.transactions t
  join public.accounts a on a.id = t.account_id
  where t.user_id = p_user and t.kind = 'spending' and a.include_in_spending
    and (t.booked_at at time zone 'Europe/London')::date between v_start and v_end;

  select coalesce(sum(t.amount), 0) into v_income
  from public.transactions t
  where t.user_id = p_user and t.kind = 'income'
    and (t.booked_at at time zone 'Europe/London')::date between v_start and v_end;

  select coalesce(sum(abs(r.amount)), 0) into v_bills_due
  from public.recurring_payments r
  where r.user_id = p_user and coalesce(r.status, 'active') ilike 'active'
    and coalesce(r.next_payment_date, (r.last_payment_at + interval '1 month')::date) between v_today and v_end;

  v_allowance := coalesce(v_profile.monthly_allowance, 0);
  v_remaining := v_allowance - v_spent;
  v_days_left := v_end - v_today + 1;

  return jsonb_build_object(
    'period_start', v_start,
    'period_end', v_end,
    'days_left', v_days_left,
    'allowance', v_allowance,
    'spent', v_spent,
    'remaining', v_remaining,
    'per_day', case when v_days_left > 0 then round(greatest(v_remaining, 0) / v_days_left, 2) else 0 end,
    'income', v_income,
    'bills_due', v_bills_due,
    'currency', v_profile.currency
  );
end;
$$;

revoke execute on function public._allowance_for(uuid) from public, anon, authenticated;

create function public.allowance_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public._allowance_for(auth.uid());
$$;

revoke execute on function public.allowance_status() from public, anon;
grant execute on function public.allowance_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Monthly cash flow and points
--   10 points for every 1% of income saved
--   20 points for every 1% of income invested
--   100 bonus points for keeping day-to-day spending within the allowance
-- ---------------------------------------------------------------------------
create function public.monthly_scores(p_months integer default 6)
returns table (
  month date,
  income numeric,
  spending numeric,
  bills numeric,
  saved numeric,
  invested numeric,
  net numeric,
  saved_pct numeric,
  invested_pct numeric,
  points_saved integer,
  points_invested integer,
  points_budget integer,
  points_total integer,
  is_current boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with months as (
    select generate_series(
      date_trunc('month', now() at time zone 'Europe/London')::date - make_interval(months => greatest(p_months, 1) - 1),
      date_trunc('month', now() at time zone 'Europe/London')::date,
      interval '1 month'
    )::date as month
  ),
  totals as (
    select
      m.month,
      coalesce(sum(t.amount) filter (where t.kind = 'income'), 0) as income,
      coalesce(sum(-t.amount) filter (where t.kind = 'spending'), 0) as spending,
      coalesce(sum(-t.amount) filter (where t.kind in ('direct_debit', 'standing_order')), 0) as bills,
      coalesce(sum(-t.amount) filter (where t.kind = 'saving'), 0) as saved,
      coalesce(sum(-t.amount) filter (where t.kind = 'investment'), 0) as invested
    from months m
    left join public.transactions t
      on t.user_id = auth.uid()
     and date_trunc('month', t.booked_at at time zone 'Europe/London')::date = m.month
    group by m.month
  ),
  scored as (
    select
      tt.*,
      case when tt.income > 0 then round(100 * tt.saved / tt.income, 1) else 0 end as saved_pct,
      case when tt.income > 0 then round(100 * tt.invested / tt.income, 1) else 0 end as invested_pct,
      (select p.monthly_allowance from public.profiles p where p.id = auth.uid()) as allowance
    from totals tt
  )
  select
    s.month, s.income, s.spending, s.bills, s.saved, s.invested,
    s.income - s.spending - s.bills - s.saved - s.invested as net,
    s.saved_pct, s.invested_pct,
    greatest(round(s.saved_pct * 10), 0)::int,
    greatest(round(s.invested_pct * 20), 0)::int,
    case when coalesce(s.allowance, 0) > 0 and s.income > 0 and s.spending <= s.allowance then 100 else 0 end,
    (greatest(round(s.saved_pct * 10), 0)
      + greatest(round(s.invested_pct * 20), 0)
      + case when coalesce(s.allowance, 0) > 0 and s.income > 0 and s.spending <= s.allowance then 100 else 0 end)::int,
    s.month = date_trunc('month', now() at time zone 'Europe/London')::date
  from scored s
  order by s.month;
$$;

grant execute on function public.monthly_scores(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- "You just spent" notifications
-- ---------------------------------------------------------------------------
create function public.money(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p < 0 then '-£' else '£' end || trim(to_char(abs(p), 'FM999,999,990.00'));
$$;

create function public.notify_on_spend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status jsonb;
  v_remaining numeric;
  v_allowance numeric;
  v_body text;
  v_who text := coalesce(nullif(new.merchant, ''), nullif(new.description, ''), 'a card payment');
begin
  if new.kind <> 'spending' or new.amount >= 0 or not new.notify then
    return null;
  end if;
  if not exists (select 1 from public.profiles p where p.id = new.user_id and p.notify_each_spend) then
    return null;
  end if;
  if not exists (select 1 from public.accounts a where a.id = new.account_id and a.include_in_spending) then
    return null;
  end if;

  v_status := public._allowance_for(new.user_id);
  v_remaining := (v_status ->> 'remaining')::numeric;
  v_allowance := (v_status ->> 'allowance')::numeric;

  if v_allowance <= 0 then
    v_body := 'Set a monthly allowance to see how much you have left.';
  elsif v_remaining < 0 then
    v_body := format('You are %s over your %s allowance with %s days to payday.',
      public.money(-v_remaining), public.money(v_allowance), v_status ->> 'days_left');
  else
    v_body := format('%s left of %s · %s days to payday (about %s a day).',
      public.money(v_remaining), public.money(v_allowance), v_status ->> 'days_left', public.money((v_status ->> 'per_day')::numeric));
  end if;

  insert into public.notifications (user_id, transaction_id, title, body)
  values (new.user_id, new.id, format('%s at %s', public.money(-new.amount), v_who), v_body);
  return null;
end;
$$;

create trigger transactions_notify_on_spend
  after insert on public.transactions
  for each row execute function public.notify_on_spend();

-- Trigger-only functions must not be callable through the API
revoke execute on function public.notify_on_spend() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.transactions_set_kind() from public, anon, authenticated;
revoke execute on function public.classify_transaction(uuid, numeric, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.reclassify_my_transactions() from public, anon;
grant execute on function public.reclassify_my_transactions() to authenticated;
