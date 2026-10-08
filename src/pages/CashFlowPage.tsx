import { useState } from "react";
import { useApp } from "../lib/data";
import { money } from "../lib/money";
import type { PeriodScore } from "../lib/types";

const SERIES = [
  { key: "bills", label: "Bills", color: "var(--series-1)" },
  { key: "spending", label: "Spending", color: "var(--series-2)" },
  { key: "saved", label: "Saved", color: "var(--series-3)" },
  { key: "invested", label: "Invested", color: "var(--series-4)" },
] as const;

const label = (p: PeriodScore) =>
  new Date(p.period_start + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export default function CashFlowPage() {
  const { scores } = useApp();
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const current = scores.find((s) => s.is_current);

  const W = 380, H = 220, padL = 44, padB = 24, padT = 10;
  const max = Math.max(1, ...scores.map((s) => Math.max(s.income, s.bills + s.spending + s.saved + s.invested)));
  const nice = Math.ceil(max / 500) * 500;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / nice);
  const slot = (W - padL) / Math.max(1, scores.length);
  const barW = Math.min(56, slot * 0.55);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * nice);

  return (
    <div className="stack-lg">
      <h1>Cash flow</h1>
      {current && (
        <section className="grid-3">
          <div className="stat">
            <span className="stat-label">In this period</span>
            <span className="stat-value">{money(current.income, { whole: true })}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Out this period</span>
            <span className="stat-value">{money(current.bills + current.spending + current.saved + current.invested, { whole: true })}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Left over</span>
            <span className={`stat-value ${current.net < 0 ? "neg" : ""}`}>{money(current.net, { whole: true })}</span>
          </div>
        </section>
      )}

      <section className="card viz">
        <div className="row-between">
          <h2>Where your pay goes, by pay period</h2>
          <button className="link" onClick={() => setShowTable(!showTable)}>{showTable ? "Show chart" : "Show table"}</button>
        </div>
        <ul className="legend">
          {SERIES.map((s) => (
            <li key={s.key}><span className="swatch" style={{ background: s.color }} />{s.label}</li>
          ))}
          <li><span className="swatch line" />Income</li>
        </ul>

        {showTable ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Period from</th><th>Income</th><th>Bills</th><th>Spending</th><th>Saved</th><th>Invested</th><th>Left over</th></tr>
              </thead>
              <tbody>
                {scores.map((s) => (
                  <tr key={s.period_start}>
                    <td>{label(s)}{s.is_current ? " (now)" : ""}</td>
                    <td>{money(s.income, { whole: true })}</td>
                    <td>{money(s.bills, { whole: true })}</td>
                    <td>{money(s.spending, { whole: true })}</td>
                    <td>{money(s.saved, { whole: true })}</td>
                    <td>{money(s.invested, { whole: true })}</td>
                    <td>{money(s.net, { whole: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="chart-box">
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Stacked bars of bills, spending, saving and investing per pay period, with income marked">
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="grid" />
                  <text x={padL - 8} y={y(t) + 4} className="axis" textAnchor="end">£{t >= 1000 ? `${t / 1000}k` : t}</text>
                </g>
              ))}
              {scores.map((s, i) => {
                const cx = padL + slot * i + slot / 2;
                let acc = 0;
                const segs = SERIES.map((ser) => {
                  const v = Math.max(0, s[ser.key]);
                  const seg = { ...ser, y0: acc, y1: acc + v };
                  acc += v;
                  return seg;
                }).filter((g) => g.y1 > g.y0);
                return (
                  <g key={s.period_start} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(i)}>
                    <rect x={cx - slot / 2} y={padT} width={slot} height={H - padT - padB} fill="transparent" />
                    {segs.map((g, j) => {
                      const top = y(g.y1), bottom = y(g.y0);
                      const h = Math.max(0, bottom - top - (j > 0 ? 2 : 0));
                      const isTop = j === segs.length - 1;
                      return isTop ? (
                        <path key={g.key} fill={g.color} opacity={hover == null || hover === i ? 1 : 0.45}
                          d={`M${cx - barW / 2},${top + h} v${-(h - 4)} q0,-4 4,-4 h${barW - 8} q4,0 4,4 v${h - 4} z`} />
                      ) : (
                        <rect key={g.key} x={cx - barW / 2} y={top} width={barW} height={h} fill={g.color} opacity={hover == null || hover === i ? 1 : 0.45} />
                      );
                    })}
                    <line x1={cx - barW / 2 - 6} x2={cx + barW / 2 + 6} y1={y(s.income)} y2={y(s.income)} className="income-line" />
                    <text x={cx} y={H - 8} className="axis" textAnchor="middle">{label(s)}{s.is_current ? "*" : ""}</text>
                  </g>
                );
              })}
            </svg>
            {hover != null && scores[hover] && (
              <div className="tooltip" style={{ left: `${((padL + slot * hover + slot / 2) / W) * 100}%` }}>
                <strong>From {label(scores[hover])}</strong>
                <span>Income {money(scores[hover].income, { whole: true })}</span>
                {SERIES.map((s) => (
                  <span key={s.key}><i className="swatch" style={{ background: s.color }} />{s.label} {money(scores[hover][s.key], { whole: true })}</span>
                ))}
                <span>Left over {money(scores[hover].net, { whole: true })}</span>
              </div>
            )}
            <p className="muted small">* current pay period, still in progress</p>
          </div>
        )}
      </section>
    </div>
  );
}
