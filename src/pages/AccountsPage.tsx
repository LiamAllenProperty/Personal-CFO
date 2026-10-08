import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useApp } from "../lib/data";
import { money } from "../lib/money";
import { supabase } from "../supabase";
import type { Account } from "../lib/types";

const TYPE_LABELS: Record<Account["account_type"], string> = {
  current: "Current account",
  savings: "Savings",
  investment: "Investments",
  credit_card: "Credit card",
};

export default function AccountsPage() {
  const { accounts, connections, refresh, syncBanks, syncing } = useApp();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (params.get("connected")) setMessage("Bank connected. Your transactions are now in your wallet.");
    else if (params.get("error")) setMessage(`The bank connection didn't complete (${params.get("error")}). Please try again.`);
    if (params.size) setParams({}, { replace: true });
  }, [params, setParams]);

  async function connectBank() {
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>("truelayer-connect", {
      body: { returnTo: window.location.origin },
    });
    if (error || !data?.url) {
      setBusy(false);
      setMessage("Bank connections aren't set up on the server yet. Try the demo data in the meantime.");
      return;
    }
    window.location.href = data.url;
  }

  async function loadDemo() {
    setBusy(true);
    const { error } = await supabase.rpc("load_demo_data");
    setBusy(false);
    setMessage(error ? error.message : "Demo bank added.");
    refresh();
  }

  async function disconnect(id: string, name: string) {
    if (!confirm(`Disconnect ${name}? Its accounts and transactions will be removed from Personal CFO.`)) return;
    await supabase.from("bank_connections").delete().eq("id", id);
    refresh();
  }

  async function updateAccount(id: string, patch: Partial<Account>) {
    await supabase.from("accounts").update(patch).eq("id", id);
    refresh();
  }

  return (
    <div className="stack-lg">
      <h1>Accounts</h1>
      {message && <p className="notice">{message}</p>}

      <section className="card stack">
        <h2>Add a bank</h2>
        <p>
          Connect current accounts, savings and credit cards securely through Open Banking (TrueLayer, FCA-regulated). We
          get read-only access: no one can move money through Personal CFO.
        </p>
        <div className="row-wrap">
          <button className="primary" onClick={connectBank} disabled={busy}>Connect a bank</button>
          <button onClick={() => syncBanks()} disabled={syncing}>{syncing ? "Refreshing…" : "Refresh now"}</button>
          {!connections.some((c) => c.provider === "demo") && <button onClick={loadDemo} disabled={busy}>Add demo bank</button>}
        </div>
      </section>

      {connections.map((c) => {
        const own = accounts.filter((a) => a.connection_id === c.id);
        const name = c.institution_name ?? "Bank";
        return (
          <section key={c.id} className="card stack">
            <div className="row-between">
              <div>
                <h2>{name}</h2>
                <span className="muted small">
                  {c.last_synced_at ? `Updated ${new Date(c.last_synced_at).toLocaleString("en-GB")}` : "Not synced yet"}
                  {c.consent_expires_at && ` · access until ${new Date(c.consent_expires_at).toLocaleDateString("en-GB")}`}
                </span>
              </div>
              <button className="link danger" onClick={() => disconnect(c.id, name)}>Disconnect</button>
            </div>
            {c.status !== "active" && (
              <p className="notice">
                {c.status_detail ?? "This connection needs attention."}{" "}
                {c.status === "expired" && <button className="link" onClick={connectBank}>Reconnect</button>}
              </p>
            )}
            <ul className="list">
              {own.map((a) => (
                <li key={a.id} className="stack-sm">
                  <div className="row-between">
                    <strong>{a.name}</strong>
                    <strong>{a.balance != null ? money(a.balance) : "—"}</strong>
                  </div>
                  <div className="row-wrap small">
                    <select value={a.account_type} onChange={(e) => updateAccount(a.id, { account_type: e.target.value as Account["account_type"] })}>
                      {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <label className="check">
                      <input type="checkbox" checked={a.include_in_spending} onChange={(e) => updateAccount(a.id, { include_in_spending: e.target.checked })} />
                      Counts towards my allowance
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
