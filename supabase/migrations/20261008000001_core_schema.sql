-- Personal CFO core schema
-- Money convention: amounts are signed. Negative = money leaving the account, positive = money arriving.

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  currency text not null default 'GBP',
  -- Money the user allows themselves for day-to-day spending each pay period
  monthly_allowance numeric(12, 2),
  -- Day of the month the user is paid (1-31). The pay period runs payday -> day before next payday.
  payday smallint not null default 1 check (payday between 1 and 31),
  notify_each_spend boolean not null default true,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Bank connections, accounts, transactions
-- ---------------------------------------------------------------------------
create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('truelayer', 'demo')),
  institution_name text,
  status text not null default 'active' check (status in ('active', 'expired', 'error', 'revoked')),
  status_detail text,
  consent_expires_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.bank_connections (user_id);

-- OAuth tokens. RLS is enabled with NO policies, so only the service role (edge functions) can read them.
create table public.bank_connection_secrets (
  connection_id uuid primary key references public.bank_connections (id) on delete cascade,
  access_token text not null,
  refresh_token text,
  access_token_expires_at timestamptz not null
);

-- Short-lived OAuth state values used to tie a bank redirect back to a user. Service role only.
create table public.oauth_states (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid not null references public.bank_connections (id) on delete cascade,
  provider_account_id text not null,
  name text not null,
  account_type text not null default 'current'
    check (account_type in ('current', 'savings', 'investment', 'credit_card')),
  currency text not null default 'GBP',
  balance numeric(14, 2),
  available numeric(14, 2),
  balance_updated_at timestamptz,
  -- Include this account in the "allowance" spending view
  include_in_spending boolean not null default true,
  created_at timestamptz not null default now(),
  unique (connection_id, provider_account_id)
);
create index on public.accounts (user_id);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  provider_txn_id text not null,
  booked_at timestamptz not null,
  amount numeric(14, 2) not null,
  currency text not null default 'GBP',
  description text not null default '',
  merchant text,
  provider_category text,
  provider_classification text[],
  kind text not null check (kind in (
    'income', 'spending', 'direct_debit', 'standing_order', 'saving', 'investment', 'transfer'
  )),
  -- When true the user set the kind by hand and automatic classification must leave it alone
  kind_locked boolean not null default false,
  -- When false no "you just spent" notification is raised (used for historical back-fill)
  notify boolean not null default true,
  created_at timestamptz not null default now(),
  unique (account_id, provider_txn_id)
);
create index on public.transactions (user_id, booked_at desc);
create index on public.transactions (account_id);

create table public.recurring_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  provider_id text not null,
  type text not null check (type in ('direct_debit', 'standing_order')),
  payee text not null,
  reference text,
  amount numeric(14, 2),
  frequency text,
  status text,
  last_payment_at timestamptz,
  next_payment_date date,
  updated_at timestamptz not null default now(),
  unique (account_id, type, provider_id)
);
create index on public.recurring_payments (user_id);

-- User-defined "if the description contains X, it's a Y" rules, applied before the built-in rules.
create table public.category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pattern text not null check (length(pattern) between 2 and 100),
  kind text not null check (kind in (
    'income', 'spending', 'direct_debit', 'standing_order', 'saving', 'investment', 'transfer'
  )),
  created_at timestamptz not null default now()
);
create index on public.category_rules (user_id);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid references public.transactions (id) on delete set null,
  title text not null,
  body text not null,
  read_at timestamptz,
  pushed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);
create index on public.notifications (created_at) where pushed_at is null;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.bank_connections enable row level security;
alter table public.bank_connection_secrets enable row level security;
alter table public.oauth_states enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.recurring_payments enable row level security;
alter table public.category_rules enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "own profile read" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "own profile update" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "own connections read" on public.bank_connections for select to authenticated using (user_id = (select auth.uid()));
create policy "own connections delete" on public.bank_connections for delete to authenticated using (user_id = (select auth.uid()));

create policy "own accounts read" on public.accounts for select to authenticated using (user_id = (select auth.uid()));
create policy "own accounts update" on public.accounts for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own transactions read" on public.transactions for select to authenticated using (user_id = (select auth.uid()));
create policy "own transactions update" on public.transactions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own recurring read" on public.recurring_payments for select to authenticated using (user_id = (select auth.uid()));

create policy "own rules all" on public.category_rules for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own notifications read" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "own notifications update" on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own push subs read" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "own push subs insert" on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own push subs delete" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

-- Column-level limits on what users may change themselves
revoke update on public.profiles from authenticated, anon;
grant update (display_name, monthly_allowance, payday, notify_each_spend, onboarded) on public.profiles to authenticated;
revoke update on public.transactions from authenticated, anon;
grant update (kind, kind_locked) on public.transactions to authenticated;
revoke update on public.accounts from authenticated, anon;
grant update (include_in_spending, account_type) on public.accounts to authenticated;
revoke update on public.notifications from authenticated, anon;
grant update (read_at) on public.notifications to authenticated;

-- Live updates in the app
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.transactions;
