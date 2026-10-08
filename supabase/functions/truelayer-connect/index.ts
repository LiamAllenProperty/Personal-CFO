// Starts a bank connection: returns the TrueLayer page where the user picks their bank and consents.
import { adminClient, corsHeaders, json, userIdFrom } from "../_shared/http.ts";
import { authLink } from "../_shared/truelayer.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = adminClient();
    const userId = await userIdFrom(req, admin);
    if (!userId) return json({ error: "Not signed in" }, 401);

    const { returnTo } = await req.json().catch(() => ({}));
    let appOrigin: string | null = null;
    try {
      appOrigin = new URL(returnTo ?? req.headers.get("origin") ?? "").origin;
    } catch {
      appOrigin = null;
    }

    const state = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
    // Clear out this user's abandoned attempts before creating a new one
    await admin.from("oauth_states").delete().eq("user_id", userId).lt("created_at", new Date(Date.now() - 3600_000).toISOString());
    const { error } = await admin.from("oauth_states").insert({ state, user_id: userId, app_origin: appOrigin });
    if (error) throw error;

    return json({ url: authLink(state) });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "Something went wrong" }, 500);
  }
});
