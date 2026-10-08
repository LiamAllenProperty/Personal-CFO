import { Link } from "react-router-dom";
import { useState } from "react";
import { useApp } from "../lib/data";
import { money, signedMoney, spendingPace } from "../lib/money";
import { supabase } from "../supabase";
import Wallet from "../components/Wallet";

const PACE_TEXT = {
  ahead: "You're spending slower than the month is passing. Nice.",
  "on-track": "You're on track for this pay period.",
  over: "You're spending faster than the month is passing. Slow down a little.",
};

export default function WalletPage() {
  const { status, transactions, connections, notifications, syncing, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const hasDemo = connections.some((c) => c.provider === "demo");

  if (!status) return <p>Loading…</p>;
  const noAllowance = status.allowance <= 0;
  const pace = spendingPace(status.allowance, status.spent, status.period_start, status.period_end);
  const recentSpends = transactions.filter((t) => t.kind === "spending").slice(0, 6);

  async function simulate() {
    setBusy(true);
    const { error } = await supabase.rpc("simulate_demo_spend");
    setBusy(false);
    if (error) alert(error.message);
    else refresh();
  }

  return (
    <div className="stack-lg">
      <section className={`hero ${status.remaining < 0 ? "hero-over" : ""}`}>
        <p className="eyebrow">Left to spend until payday</p>
        <p className="hero-amount">{money(status.remaining)}</p>
        {noAllowance ? (
          <p>
            <Link to="/settings">Set a monthly allowance</Link> to start your wallet.
          </p>
        ) : (
          <p className="hero-sub">
            of {money(status.allowance, { whole: true })} · {status.days_left} days to go · about {money(status.per_day)} a day
          </p>
        )}
        {syncing && <p className="muted small">Checking your bank for new transactions…</p>}
      </section>

      {!noAllowance && (
        <section className="card">
          <Wallet allowance={status.allowance} spent={status.spent} />
          <p className={`pace pace-${pace}`}>{PACE_TEXT[pace]}</p>
        </section>
      )}

      <section className="grid-3">
        <div className="stat">
          <span className="stat-label">Spent so far</span>
          <span className="stat-value">{money(status.spent)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Bills still to come</span>
          <span className="stat-value">{money(status.bills_due)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Paid in this period</span>
          <span className="stat-value">{money(status.income)}</span>
        </div>
      </section>

      {hasDemo && (
        <section className="card row-between">
          <div>
            <strong>Try it:</strong> pretend you just tapped your card.
            <p className="muted small">You'll get a notification showing what's left.</p>
          </div>
          <button className="primary" onClick={simulate} disabled={busy}>
            {busy ? "…" : "Tap card"}
          </button>
        </section>
      )}

      {connections.length === 0 && (
        <section className="card">
          <h2>Connect your bank</h2>
          <p>Link your accounts so every card and contactless payment comes out of your wallet automatically.</p>
          <Link className="button primary" to="/accounts">Connect accounts</Link>
        </section>
      )}

      <section className="card">
        <div className="row-between">
          <h2>Latest spending</h2>
          <Link to="/activity">See all</Link>
        </div>
        {recentSpends.length === 0 ? (
          <p className="muted">Nothing yet this period.</p>
        ) : (
          <ul className="list">
            {recentSpends.map((t) => (
              <li key={t.id} className="row-between">
                <span>
                  {t.merchant || t.description}
                  <span className="muted small block">{new Date(t.booked_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                </span>
                <span className={t.amount < 0 ? "neg" : "pos"}>{signedMoney(t.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {notifications.length > 0 && (
        <section className="card">
          <h2>Recent alerts</h2>
          <ul className="list">
            {notifications.slice(0, 4).map((n) => (
              <li key={n.id}>
                <strong>{n.title}</strong>
                <span className="muted small block">{n.body}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
