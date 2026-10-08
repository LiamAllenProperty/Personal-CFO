import { useApp } from "../lib/data";
import { levelFor, money } from "../lib/money";

export default function PointsPage() {
  const { scores } = useApp();
  const total = scores.reduce((s, p) => s + p.points_total, 0);
  const level = levelFor(total);
  const toNext = level.next != null ? level.next - total : 0;
  const progress = level.next != null ? (total - level.min) / (level.next - level.min) : 1;
  const current = scores.find((s) => s.is_current);

  return (
    <div className="stack-lg">
      <h1>Points</h1>
      <section className="hero">
        <p className="eyebrow">{level.name}</p>
        <p className="hero-amount">{total.toLocaleString("en-GB")} pts</p>
        <div className="meter" aria-hidden><div style={{ width: `${Math.min(100, progress * 100)}%` }} /></div>
        <p className="hero-sub">{level.next != null ? `${toNext.toLocaleString("en-GB")} points to the next level` : "Top level reached"}</p>
      </section>

      <section className="card">
        <h2>How to earn</h2>
        <ul className="list">
          <li className="row-between"><span>Every 1% of your pay you <strong>save</strong></span><strong>10 pts</strong></li>
          <li className="row-between"><span>Every 1% of your pay you <strong>invest</strong></span><strong>20 pts</strong></li>
          <li className="row-between"><span>Keep spending within your allowance</span><strong>100 pts</strong></li>
        </ul>
        {current && current.income > 0 && (
          <p className="muted small">
            Example: saving 10% and investing 5% of your pay earns 100 + 100 = 200 points, plus 100 if you stay within your allowance.
          </p>
        )}
      </section>

      <section className="card">
        <h2>By pay period</h2>
        <ul className="list">
          {[...scores].reverse().map((s) => (
            <li key={s.period_start}>
              <div className="row-between">
                <strong>
                  {new Date(s.period_start + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })} –{" "}
                  {new Date(s.period_end + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  {s.is_current && <span className="tag">in progress</span>}
                </strong>
                <strong>{s.points_total} pts</strong>
              </div>
              <span className="muted small block">
                Saved {money(s.saved, { whole: true })} ({s.saved_pct}%) · {s.points_saved} pts &nbsp;·&nbsp; Invested{" "}
                {money(s.invested, { whole: true })} ({s.invested_pct}%) · {s.points_invested} pts &nbsp;·&nbsp; Within allowance{" "}
                {s.points_budget ? "✓ 100 pts" : s.income > 0 ? "✗" : "—"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
