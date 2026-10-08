-- Remember which app origin started a bank connection so the OAuth callback can send the user back there.
alter table public.oauth_states add column app_origin text;
