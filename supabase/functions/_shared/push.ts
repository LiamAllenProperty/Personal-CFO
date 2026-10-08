// Sends web push notifications for notification rows that haven't been pushed yet.
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { env } from "./http.ts";

let configured = false;
function configure() {
  if (configured) return;
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@personal-cfo.app",
    env("VAPID_PUBLIC_KEY"),
    env("VAPID_PRIVATE_KEY"),
  );
  configured = true;
}

export async function dispatchPending(admin: SupabaseClient, userId?: string): Promise<number> {
  configure();
  let query = admin
    .from("notifications")
    .select("id, user_id, title, body")
    .is("pushed_at", null)
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order("created_at")
    .limit(200);
  if (userId) query = query.eq("user_id", userId);
  const { data: pending, error } = await query;
  if (error) throw error;
  if (!pending?.length) return 0;

  const userIds = [...new Set(pending.map((n) => n.user_id))];
  const { data: subs } = await admin.from("push_subscriptions").select("*").in("user_id", userIds);

  let sent = 0;
  for (const n of pending) {
    for (const sub of (subs ?? []).filter((s) => s.user_id === n.user_id)) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: n.title, body: n.body, tag: n.id, url: "/" }),
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The browser unsubscribed - forget this endpoint
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.error("push failed", status, err);
        }
      }
    }
    await admin.from("notifications").update({ pushed_at: new Date().toISOString() }).eq("id", n.id);
  }
  return sent;
}
