import { pickDenomination, walletNotes } from "../lib/money";

/** Draws the allowance as banknotes; spent notes fade out, like cash leaving your wallet. */
export default function Wallet({ allowance, spent }: { allowance: number; spent: number }) {
  const denomination = pickDenomination(allowance);
  const notes = walletNotes(allowance, spent, denomination);
  if (!notes.length) return null;
  const full = notes.filter((n) => n.fill === 1).length;
  return (
    <div className="wallet" role="img" aria-label={`${full} of ${notes.length} £${denomination} notes left`}>
      {notes.map((n, i) => (
        <div key={i} className={`note ${n.fill === 0 ? "spent" : ""}`}>
          <div className="note-fill" style={{ width: `${n.fill * 100}%` }} />
          <span className="note-value">£{denomination}</span>
        </div>
      ))}
      <p className="wallet-caption">
        Each note is £{denomination}. Faded notes are already spent.
      </p>
    </div>
  );
}
