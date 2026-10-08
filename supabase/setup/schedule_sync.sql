-- Run once in the Supabase SQL editor AFTER setting the CRON_SECRET edge function secret.
-- Replace <CRON_SECRET> with the same value. Syncs every bank connection every 6 hours
-- (UK Open Banking allows 4 background refreshes per account per day) and sends any queued push alerts.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('<CRON_SECRET>', 'cron_secret');

select cron.schedule(
  'personal-cfo-sync',
  '5 */6 * * *',
  $$
  select net.http_post(
    url := 'https://zdiztndggyrlwrjovsnl.supabase.co/functions/v1/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
