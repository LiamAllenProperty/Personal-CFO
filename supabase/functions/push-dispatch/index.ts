// Sends any queued notifications as web push messages.
// The app calls this after something happens in the foreground; the scheduler calls it too.
// GET returns the public VAPID key so the app can subscribe devices.
import { adminClient, corsHeaders, isCron, json, userIdFrom } from "../_shared/http.ts";
import { dispatchPending } from "../_shared/push.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // The app asks for the public key it needs to subscribe this device to push messages
  if (req.method === "GET") return json({ publicKey: Deno.env.get("VAPID_PUBLIC_KEY") ?? null });
  const admin = adminClient();
  const cron = isCron(req);
  const userId = cron ? null : await userIdFrom(req, admin);
  if (!cron && !userId) return json({ error: "Not signed in" }, 401);
  try {
    const sent = await dispatchPending(admin, userId ?? undefined);
    return json({ sent });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "Push failed" }, 500);
  }
});
