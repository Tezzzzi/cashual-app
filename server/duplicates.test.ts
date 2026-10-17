import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as db from "./db";
import { findDuplicate } from "./duplicates";

/**
 * The case these guard against really happened: on 2026-09-29 one 85.36 EUR
 * purchase at Mega was recorded three times between 18:18 and 18:20, because
 * two cards were declined before the third went through. Four such groups
 * accumulated in three weeks and overstated spending by 13%.
 */

const USER = 1;
const BASE = Date.parse("2026-09-29T18:18:00Z");

function existing(rows: Array<Partial<Record<string, unknown>>>) {
  vi.spyOn(db, "getTransactions").mockResolvedValue(
    rows.map((r) => ({
      transaction: {
        id: 47,
        amount: "85.36",
        currency: "EUR",
        description: "Mega",
        date: BASE,
        ...r,
      },
    })) as any
  );
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("findDuplicate — Wallet retries", () => {
  it("catches the same purchase tapped again a minute later", async () => {
    existing([{}]);
    const hit = await findDuplicate(
      USER,
      { amount: 85.36, description: "Mega", currency: "EUR", date: BASE + 60_000 },
      "wallet"
    );
    expect(hit?.id).toBe(47);
  });

  it("catches a retry from a different card", async () => {
    // The decisive case: same shop, same amount, seconds apart, second card.
    // A different card makes a duplicate *more* likely, not less.
    existing([{ description: "Mega (Visa 1234)" }]);
    const hit = await findDuplicate(
      USER,
      {
        amount: 85.36,
        description: "Mega (Mastercard 5678)",
        currency: "EUR",
        date: BASE + 80_000,
        card: "Mastercard 5678",
      },
      "wallet"
    );
    expect(hit).not.toBeNull();
    expect(hit?.differentCard).toBe(true);
  });

  it("keeps a genuine second visit later the same day", async () => {
    // Two real trips to the same shop for the same amount must both survive —
    // this is why the window is ten minutes and not a day.
    existing([{}]);
    const hit = await findDuplicate(
      USER,
      { amount: 85.36, description: "Mega", currency: "EUR", date: BASE + 4 * 60 * 60 * 1000 },
      "wallet"
    );
    expect(hit).toBeNull();
  });

  it("does not treat a different amount at the same shop as a repeat", async () => {
    existing([{}]);
    const hit = await findDuplicate(
      USER,
      { amount: 12.0, description: "Mega", currency: "EUR", date: BASE + 60_000 },
      "wallet"
    );
    expect(hit).toBeNull();
  });

  it("does not treat the same amount at a different shop as a repeat", async () => {
    existing([{}]);
    const hit = await findDuplicate(
      USER,
      { amount: 85.36, description: "Aroma", currency: "EUR", date: BASE + 60_000 },
      "wallet"
    );
    expect(hit).toBeNull();
  });

  it("keeps the same number in a different currency", async () => {
    // 85.36 EUR and 85.36 AZN are different purchases.
    existing([{}]);
    const hit = await findDuplicate(
      USER,
      { amount: 85.36, description: "Mega", currency: "AZN", date: BASE + 60_000 },
      "wallet"
    );
    expect(hit).toBeNull();
  });

  it("ignores case and surrounding whitespace in the merchant", async () => {
    existing([{}]);
    const hit = await findDuplicate(
      USER,
      { amount: 85.36, description: "  mega ", currency: "EUR", date: BASE + 30_000 },
      "wallet"
    );
    expect(hit).not.toBeNull();
  });

  it("refuses to match on amount alone when there is no description", async () => {
    // Too weak a signal to justify discarding someone's transaction.
    existing([{}]);
    const hit = await findDuplicate(
      USER,
      { amount: 85.36, description: "", currency: "EUR", date: BASE },
      "wallet"
    );
    expect(hit).toBeNull();
  });
});

describe("findDuplicate — window per source", () => {
  it("still catches a receipt scanned hours later", async () => {
    existing([{}]);
    const hit = await findDuplicate(
      USER,
      { amount: 85.36, description: "Mega", currency: "EUR", date: BASE + 6 * 60 * 60 * 1000 },
      "receipt"
    );
    expect(hit?.id).toBe(47);
  });

  it("uses the narrow window for voice", async () => {
    existing([{}]);
    const hit = await findDuplicate(
      USER,
      { amount: 85.36, description: "Mega", currency: "EUR", date: BASE + 30 * 60 * 1000 },
      "voice"
    );
    expect(hit).toBeNull();
  });
});
