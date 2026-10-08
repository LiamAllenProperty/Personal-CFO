# Personal CFO

A personal finance app that makes card and contactless spending feel like cash.

- **Wallet**: your monthly spending allowance drawn as banknotes. Every card tap removes money from the wallet, so you can see it going down.
- **Spend alerts**: a notification each time you spend, e.g. *"£9.42 at TfL Travel. £262.35 left of £600.00 · 20 days to payday (about £13.12 a day)."*
- **Bank connections**: all your UK current accounts, savings and credit cards through Open Banking (TrueLayer), read-only.
- **Bills**: direct debits and standing orders, and how much is still due before payday.
- **Cash flow**: where each pay period's income went: bills, spending, saving and investing.
- **Points**: 10 points per 1% of income saved, 20 points per 1% invested, and 100 bonus points for staying within your allowance. Levels go from Starter up to Personal CFO.
- **Demo mode**: try everything with realistic sample data before connecting a bank.

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| Web app (React + Vite, installable PWA) | `src/`, deployed to the `personal-cfo` Cloudflare Worker (`wrangler.jsonc`) | All screens; registers the service worker for push |
| Database | `supabase/migrations/` (Supabase project `zdiztndggyrlwrjovsnl`) | Tables with row level security, transaction classification, pay-period maths, points, the "you just spent" trigger, demo data |
| `truelayer-connect` | `supabase/functions/` | Creates the bank consent link |
| `truelayer-callback` | 〃 | Stores tokens, runs the first sync, returns the user to the app |
| `sync` | 〃 | Pulls accounts, balances, transactions, direct debits and standing orders. Runs on a schedule and when the app opens |
| `push-dispatch` | 〃 | Sends queued alerts as web push notifications |

Every new spending transaction goes through a database trigger (`notify_on_spend`). The trigger works out what's left of the allowance for the current pay period and writes a notification row. The app shows it instantly over Realtime, and `push-dispatch` delivers it to the user's phone.

Transactions are classified automatically: salary is income, Vanguard/ISA/broker payments are investing, payments to savings are saving, and direct debits, standing orders and transfers are recognised too. Users can re-categorise anything and choose "always treat X like this".

## One-time setup (secrets)

Set these in **Supabase → Edge Functions → Secrets**:

| Secret | Value |
|---|---|
| `TRUELAYER_CLIENT_ID` / `TRUELAYER_CLIENT_SECRET` | From the [TrueLayer console](https://console.truelayer.com). Add the redirect URI `https://zdiztndggyrlwrjovsnl.supabase.co/functions/v1/truelayer-callback` |
| `TRUELAYER_ENV` | `sandbox` while testing (use the "Mock" bank), `live` once TrueLayer approves your app |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Run `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | `mailto:you@example.com` |
| `CRON_SECRET` | Any long random string (`openssl rand -hex 32`) |
| `APP_URL` | Optional: your app's URL, used if the bank redirect can't tell where you came from |

Then run `supabase/setup/schedule_sync.sql` in the SQL editor, with the same `CRON_SECRET`.

In **Supabase → Authentication → URL Configuration**, set the Site URL to the deployed app URL so sign-up emails link back to it.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # type-check + production build
npm run deploy     # build and deploy to Cloudflare (needs wrangler login)
```

## Limits worth knowing

- **Alerts aren't instant.** Open Banking doesn't push card payments the moment they happen. Banks usually show a payment within minutes to hours, and background refreshes are capped at 4 per account per day. Personal CFO checks every 6 hours and every time you open the app.
- **Bank consent lasts about 90 days** on many banks; the Accounts screen prompts the user to reconnect.
- **iPhone push** works only after adding the app to the Home Screen (Share → Add to Home Screen), on iOS 16.4 or later.
