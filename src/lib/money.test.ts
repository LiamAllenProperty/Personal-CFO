import { describe, expect, it } from "vitest";
import { levelFor, money, pickDenomination, signedMoney, spendingPace, suggestAllowance, walletNotes } from "./money";

describe("money formatting", () => {
  it("formats pounds", () => {
    expect(money(1234.5)).toBe("£1,234.50");
    expect(money(600, { whole: true })).toBe("£600");
    expect(signedMoney(-4.2)).toBe("-£4.20");
    expect(signedMoney(2850)).toBe("+£2,850.00");
  });
});

describe("wallet notes", () => {
  it("chooses a denomination that keeps the wallet readable", () => {
    expect(pickDenomination(100)).toBe(5);
    expect(pickDenomination(600)).toBe(20);
    expect(pickDenomination(1400)).toBe(50);
    expect(pickDenomination(50000)).toBe(100);
  });

  it("empties notes from the end as money is spent", () => {
    const notes = walletNotes(100, 30, 20);
    expect(notes.map((n) => n.fill)).toEqual([1, 1, 1, 0.5, 0]);
  });

  it("handles an allowance that isn't a multiple of the note", () => {
    const notes = walletNotes(50, 0, 20);
    expect(notes).toHaveLength(3);
    expect(notes.every((n) => n.fill === 1)).toBe(true);
    expect(walletNotes(50, 45, 20).map((n) => n.fill)).toEqual([0.25, 0, 0]);
  });

  it("shows an empty wallet when overspent and nothing when there is no allowance", () => {
    expect(walletNotes(40, 90, 20).map((n) => n.fill)).toEqual([0, 0]);
    expect(walletNotes(0, 10)).toEqual([]);
  });
});

describe("spending pace", () => {
  const today = new Date("2026-10-13T12:00:00");
  it("compares spending with time elapsed", () => {
    // Half way through the period
    expect(spendingPace(600, 300, "2026-09-28", "2026-10-27", today)).toBe("on-track");
    expect(spendingPace(600, 100, "2026-09-28", "2026-10-27", today)).toBe("ahead");
    expect(spendingPace(600, 500, "2026-09-28", "2026-10-27", today)).toBe("over");
    expect(spendingPace(600, 700, "2026-09-28", "2026-10-27", today)).toBe("over");
  });
});

describe("levels", () => {
  it("maps points to levels", () => {
    expect(levelFor(0)).toEqual({ name: "Starter", min: 0, next: 500 });
    expect(levelFor(1600).name).toBe("Silver Saver");
    expect(levelFor(20000)).toEqual({ name: "Personal CFO", min: 12000, next: null });
  });
});

describe("allowance suggestion", () => {
  it("is income minus bills, saving and investing, rounded down to £10", () => {
    expect(
      suggestAllowance([
        { income: 2850, bills: 1261.39, saved: 300, invested: 200 },
        { income: 0, bills: 500, saved: 0, invested: 0 },
      ]),
    ).toBe(1080);
    expect(suggestAllowance([])).toBeNull();
  });
});
