// Syncs bank data. Called two ways:
//  * by the scheduler (x-cron-secret header) - syncs every active connection
//  * by the app (user's bearer token) - syncs that user's connections with them "present",
//    which TrueLayer doesn't rate limit
import { adminClient, clientIp, corsHeaders, isCron, json, userIdFrom } from "../_shared/http.ts";
import { syncConnection } from "../_shared/sync.ts";
import { dispatchPending } from "../_shared/push.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = adminClient();
  const cron = isCron(req);
  const userId = cron ? null : await userIdFrom(req, admin);
  if (!cron && !userId) return json({ error: "Not signed in" }, 401);

  let query = admin
    .from("bank_connections")
    .select("id, user_id, last_synced_at")
    .eq("provider", "truelayer")
    .in("status", ["active", "error"]);
  if (userId) query = query.eq("user_id", userId);
  const { data: connections, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const psuIp = cron ? undefined : clientIp(req);
  const results = [];
  for (const connection of connections ?? []) {
    results.push(await syncConnection(admin, connection, psuIp));
  }

  let pushed = 0;
  try {
    pushed = await dispatchPending(admin, userId ?? undefined);
  } catch (err) {
    console.error("push dispatch failed", err);
  }
  return json({ results, pushed });
});
