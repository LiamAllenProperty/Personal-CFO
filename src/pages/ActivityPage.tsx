import { useMemo, useState } from "react";
import { useApp } from "../lib/data";
import { signedMoney } from "../lib/money";
import { KIND_LABELS, type Kind, type Transaction } from "../lib/types";
import { supabase } from "../supabase";

const FILTERS: Array<{ id: string; label: string; kinds: Kind[] | null }> = [
  { id: "all", label: "All", kinds: null },
  { id: "spending", label: "Spending", kinds: ["spending"] },
  { id: "income", label: "Income", kinds: ["income"] },
  { id: "bills", label: "Bills", kinds: ["direct_debit", "standing_order"] },
  { id: "growth", label: "Saving & investing", kinds: ["saving", "investment"] },
];

export default function ActivityPage() {
  const { transactions, refresh, session } = useApp();
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<Transaction | null>(null);

  const groups = useMemo(() => {
    const kinds = FILTERS.find((f) => f.id === filter)?.kinds;
    const byDay = new Map<string, Transaction[]>();
    for (const t of transactions) {
      if (kinds && !kinds.includes(t.kind)) continue;
      const day = new Date(t.booked_at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
      byDay.set(day, [...(byDay.get(day) ?? []), t]);
    }
    return [...byDay.entries()];
  }, [transactions, filter]);

  return (
    <div className="stack-lg">
      <h1>Activity</h1>
      <div className="chips" role="tablist">
        {FILTERS.map((f) => (
          <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? "chip active" : "chip"} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {groups.length === 0 && <p className="muted">No transactions here yet.</p>}
      {groups.map(([day, items]) => (
        <section key={day} className="card">
          <h3 className="day">{day}</h3>
          <ul className="list">
            {items.map((t) => (
              <li key={t.id}>
                <button className="row-between plain" onClick={() => setEditing(t)}>
                  <span>
                    {t.merchant || t.description}
                    <span className={`tag tag-${t.kind}`}>{KIND_LABELS[t.kind]}</span>
                  </span>
                  <span className={t.amount < 0 ? "neg" : "pos"}>{signedMoney(t.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {editing && (
        <KindEditor
          txn={editing}
          userId={session.user.id}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function KindEditor({ txn, userId, onClose, onSaved }: { txn: Transaction; userId: string; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<Kind>(txn.kind);
  const [always, setAlways] = useState(true);
  const [busy, setBusy] = useState(false);
  const pattern = (txn.merchant || txn.description).trim().slice(0, 60);

  async function save() {
    setBusy(true);
    await supabase.from("transactions").update({ kind, kind_locked: true }).eq("id", txn.id);
    if (always && pattern.length >= 2) {
      await supabase.from("category_rules").insert({ user_id: userId, pattern, kind });
      await supabase.rpc("reclassify_my_transactions");
    }
    setBusy(false);
    onSaved();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet stack" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Change category">
        <h2>{txn.merchant || txn.description}</h2>
        <p className="muted">{signedMoney(txn.amount)} · {new Date(txn.booked_at).toLocaleString("en-GB")}</p>
        <label>
          What is this?
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
          Always treat “{pattern}” like this
        </label>
        <p className="muted small">
          Payments into savings count as <em>Saving</em> and into ISAs, pensions or brokers as <em>Investing</em>. Both earn points.
          <em> Transfer</em> is for moving money between your own accounts.
        </p>
        <div className="row-end">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>Save</button>
        </div>
      </div>
    </div>
  );
}
