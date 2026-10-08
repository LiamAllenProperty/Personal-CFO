-- Demo mode: lets someone try the app with realistic sample data before connecting a real bank.

create function public.load_demo_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_conn uuid;
  v_current uuid;
  v_savings uuid;
  v_day date;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_payday int := 28;
  v_merchants text[] := array[
    'Tesco', 'Pret A Manger', 'TfL Travel', 'Amazon', 'Sainsbury''s', 'Costa Coffee', 'Uber',
    'Deliveroo', 'Boots', 'Greggs', 'Aldi', 'Shell', 'Cinema', 'The Red Lion', 'Zara'
  ];
  v_amounts numeric[] := array[34, 7.5, 6.8, 22, 41, 4.2, 14, 24, 9, 3.5, 28, 55, 18, 26, 45];
  v_n int;
  v_i int;
  v_k int;
  v_seq int := 0;
begin
  if v_user is null then
    raise exception 'not signed in';
  end if;

  -- Already loaded? Leave it alone (the user removes demo data by disconnecting "Demo Bank").
  if exists (select 1 from public.bank_connections where user_id = v_user and provider = 'demo') then
    return;
  end if;

  insert into public.bank_connections (user_id, provider, institution_name, last_synced_at)
  values (v_user, 'demo', 'Demo Bank', now())
  returning id into v_conn;

  insert into public.accounts (user_id, connection_id, provider_account_id, name, account_type, balance, available, balance_updated_at)
  values (v_user, v_conn, 'demo-current', 'Demo Current Account', 'current', 1240.55, 1240.55, now())
  returning id into v_current;

  insert into public.accounts (user_id, connection_id, provider_account_id, name, account_type, balance, balance_updated_at, include_in_spending)
  values (v_user, v_conn, 'demo-savings', 'Demo Easy Saver', 'savings', 6420.00, now(), false)
  returning id into v_savings;

  update public.profiles
  set payday = v_payday,
      monthly_allowance = coalesce(monthly_allowance, 600)
  where id = v_user;

  for v_day in select generate_series(v_today - 100, v_today, interval '1 day')::date loop
    -- Monthly salary and commitments
    if extract(day from v_day) = v_payday then
      insert into public.transactions (user_id, account_id, provider_txn_id, booked_at, amount, description, merchant, provider_category, notify)
      values
        (v_user, v_current, 'demo-' || (v_seq + 1), v_day + time '07:00', 2850.00, 'ACME LTD SALARY', 'Acme Ltd', 'CREDIT', false),
        (v_user, v_current, 'demo-' || (v_seq + 2), v_day + time '09:00', -300.00, 'TO SAVINGS EASY SAVER', null, 'STANDING_ORDER', false),
        (v_user, v_current, 'demo-' || (v_seq + 3), v_day + time '09:05', -200.00, 'VANGUARD ISA', 'Vanguard', 'STANDING_ORDER', false);
      v_seq := v_seq + 3;
    end if;
    if extract(day from v_day) = 1 then
      insert into public.transactions (user_id, account_id, provider_txn_id, booked_at, amount, description, merchant, provider_category, notify)
      values
        (v_user, v_current, 'demo-' || (v_seq + 1), v_day + time '06:00', -950.00, 'RENT J SMITH', 'J Smith (landlord)', 'STANDING_ORDER', false),
        (v_user, v_current, 'demo-' || (v_seq + 2), v_day + time '06:10', -145.00, 'COUNCIL TAX', 'Council Tax', 'DIRECT_DEBIT', false),
        (v_user, v_current, 'demo-' || (v_seq + 3), v_day + time '06:20', -92.40, 'OCTOPUS ENERGY', 'Octopus Energy', 'DIRECT_DEBIT', false);
      v_seq := v_seq + 3;
    end if;
    if extract(day from v_day) = 12 then
      insert into public.transactions (user_id, account_id, provider_txn_id, booked_at, amount, description, merchant, provider_category, notify)
      values
        (v_user, v_current, 'demo-' || (v_seq + 1), v_day + time '06:00', -28.00, 'EE MOBILE', 'EE', 'DIRECT_DEBIT', false),
        (v_user, v_current, 'demo-' || (v_seq + 2), v_day + time '06:05', -35.00, 'PUREGYM', 'PureGym', 'DIRECT_DEBIT', false),
        (v_user, v_current, 'demo-' || (v_seq + 3), v_day + time '06:10', -10.99, 'NETFLIX.COM', 'Netflix', 'DIRECT_DEBIT', false);
      v_seq := v_seq + 3;
    end if;

    -- Day-to-day card and contactless spending (0-3 per day)
    v_n := floor(random() * 4)::int;
    for v_i in 1..v_n loop
      v_k := 1 + floor(random() * array_length(v_merchants, 1))::int;
      v_seq := v_seq + 1;
      insert into public.transactions (user_id, account_id, provider_txn_id, booked_at, amount, description, merchant, provider_category, notify)
      values (
        v_user, v_current, 'demo-' || v_seq,
        v_day + make_interval(hours => 8 + floor(random() * 13)::int, mins => floor(random() * 60)::int),
        -round((v_amounts[v_k] * (0.25 + random() * 0.5))::numeric, 2),
        upper(v_merchants[v_k]) || ' CONTACTLESS', v_merchants[v_k], 'PURCHASE', false
      );
    end loop;
  end loop;

  insert into public.recurring_payments (user_id, account_id, provider_id, type, payee, reference, amount, frequency, status, last_payment_at, next_payment_date)
  values
    (v_user, v_current, 'demo-so-rent', 'standing_order', 'J Smith (landlord)', 'RENT', 950.00, 'Monthly', 'active', null,
      (date_trunc('month', v_today) + interval '1 month')::date),
    (v_user, v_current, 'demo-so-save', 'standing_order', 'Easy Saver', 'SAVINGS', 300.00, 'Monthly', 'active', null,
      (select pp.period_end + 1 from public.pay_period(v_payday, v_today) pp)),
    (v_user, v_current, 'demo-so-invest', 'standing_order', 'Vanguard', 'ISA', 200.00, 'Monthly', 'active', null,
      (select pp.period_end + 1 from public.pay_period(v_payday, v_today) pp)),
    (v_user, v_current, 'demo-dd-council', 'direct_debit', 'Council Tax', null, 145.00, 'Monthly', 'active',
      date_trunc('month', v_today), null),
    (v_user, v_current, 'demo-dd-energy', 'direct_debit', 'Octopus Energy', null, 92.40, 'Monthly', 'active',
      date_trunc('month', v_today), null),
    (v_user, v_current, 'demo-dd-ee', 'direct_debit', 'EE', null, 28.00, 'Monthly', 'active',
      case when extract(day from v_today) >= 12 then date_trunc('month', v_today) + interval '11 days'
           else date_trunc('month', v_today) - interval '1 month' + interval '11 days' end, null),
    (v_user, v_current, 'demo-dd-gym', 'direct_debit', 'PureGym', null, 35.00, 'Monthly', 'active',
      case when extract(day from v_today) >= 12 then date_trunc('month', v_today) + interval '11 days'
           else date_trunc('month', v_today) - interval '1 month' + interval '11 days' end, null),
    (v_user, v_current, 'demo-dd-netflix', 'direct_debit', 'Netflix', null, 10.99, 'Monthly', 'active',
      case when extract(day from v_today) >= 12 then date_trunc('month', v_today) + interval '11 days'
           else date_trunc('month', v_today) - interval '1 month' + interval '11 days' end, null);
end;
$$;

-- Pretend the user just tapped their card somewhere, to show the spend notification.
create function public.simulate_demo_spend()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_account uuid;
  v_id uuid;
  v_merchants text[] := array['Pret A Manger', 'Tesco Express', 'Costa Coffee', 'TfL Travel', 'Boots', 'Greggs', 'Deliveroo'];
  v_k int := 1 + floor(random() * 7)::int;
begin
  select a.id into v_account
  from public.accounts a
  join public.bank_connections c on c.id = a.connection_id
  where a.user_id = v_user and c.provider = 'demo' and a.account_type = 'current'
  limit 1;
  if v_account is null then
    raise exception 'Load the demo data first';
  end if;

  insert into public.transactions (user_id, account_id, provider_txn_id, booked_at, amount, description, merchant, provider_category, notify)
  values (v_user, v_account, 'demo-live-' || gen_random_uuid(), now(),
          -round((3 + random() * 30)::numeric, 2), upper(v_merchants[v_k]) || ' CONTACTLESS', v_merchants[v_k], 'PURCHASE', true)
  returning id into v_id;

  update public.accounts set balance = balance + (select amount from public.transactions where id = v_id),
                             available = available + (select amount from public.transactions where id = v_id),
                             balance_updated_at = now()
  where id = v_account;
  return v_id;
end;
$$;

revoke execute on function public.load_demo_data() from public, anon;
revoke execute on function public.simulate_demo_spend() from public, anon;
grant execute on function public.load_demo_data() to authenticated;
grant execute on function public.simulate_demo_spend() to authenticated;
