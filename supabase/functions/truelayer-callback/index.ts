// TrueLayer redirects here after the user consents. Stores the tokens, runs the first sync,
// then sends the user back to the app.
import { adminClient, clientIp } from "../_shared/http.ts";
import { exchangeCode } from "../_shared/truelayer.ts";
import { syncConnection } from "../_shared/sync.ts";

function back(origin: string | null, params: Record<string, string>): Response {
  const base = origin ?? Deno.env.get("APP_URL");
  if (!base) {
    const ok = "connected" in params;
    return new Response(ok ? "Bank connected. You can return to Personal CFO." : "Bank connection failed. Please try again.", {
      status: ok ? 200 : 400,
    });
  }
  return new Response(null, { status: 302, headers: { Location: `${base}/accounts?${new URLSearchParams(params)}` } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const admin = adminClient();

  if (!state) return new Response("Missing state", { status: 400 });
  const { data: pending } = await admin.from("oauth_states").select("*").eq("state", state).maybeSingle();
  if (!pending) return new Response("This link has expired. Please try connecting your bank again.", { status: 400 });
  await admin.from("oauth_states").delete().eq("state", state);

  if (!code || Date.now() - new Date(pending.created_at).getTime() > 3600_000) {
    return back(pending.app_origin, { error: url.searchParams.get("error") ?? "cancelled" });
  }

  try {
    const tokens = await exchangeCode(code);
    const { data: connection, error } = await admin
      .from("bank_connections")
      .insert({ user_id: pending.user_id, provider: "truelayer", institution_name: "Your bank" })
      .select("id, user_id, last_synced_at")
      .single();
    if (error) throw error;

    const { error: secretError } = await admin.from("bank_connection_secrets").insert({
      connection_id: connection.id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    });
    if (secretError) throw secretError;

    const result = await syncConnection(admin, connection, clientIp(req));
    return back(pending.app_origin, result.ok ? { connected: "1" } : { error: "sync_failed" });
  } catch (err) {
    console.error(err);
    return back(pending.app_origin, { error: "connect_failed" });
  }
});
