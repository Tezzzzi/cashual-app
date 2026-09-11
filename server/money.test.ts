import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as rates from "./exchange-rates";
import { toDisplayAmount, toDisplayAmounts, sumBuckets } from "./money";

/**
 * The bug these guard against: changing preferredCurrency relabelled stored
 * amounts instead of converting them, so a 50 AZN car wash displayed as
 * "50 EUR", and reports summed AZN and EUR rows as bare numbers.
 */

const AZN_TO_EUR = 0.5; // 50 AZN = 25 EUR, matching the reported case.
const DAY = new Date("2026-09-01T12:00:00Z").getTime();

beforeEach(() => {
  vi.spyOn(rates, "tryGetExchangeRate").mockImplementation(async (from, to) => {
    const f = from.toUpperCase();
    const t = to.toUpperCase();
    if (f === t) return 1;
    if (f === "AZN" && t === "EUR") return AZN_TO_EUR;
    if (f === "EUR" && t === "AZN") return 1 / AZN_TO_EUR;
    return null; // unknown pair => no rate
  });
});

afterEach(() => vi.restoreAllMocks());

describe("toDisplayAmount", () => {
  it("converts a stored AZN amount into EUR instead of relabelling it", async () => {
    const row = { amount: "50.00", currency: "AZN", date: DAY };
    const d = await toDisplayAmount(row, "EUR");
    expect(d.amount).toBe(25);
    expect(d.currency).toBe("EUR");
    expect(d.converted).toBe(true);
  });

  it("never returns the stored number labelled as a different currency", async () => {
    // Regression guard for the exact defect: 50 AZN must not read as 50 EUR.
    const row = { amount: "50.00", currency: "AZN", date: DAY };
    const d = await toDisplayAmount(row, "EUR");
    expect(!(d.amount === 50 && d.currency === "EUR")).toBe(true);
  });

  it("uses the originally entered amount when it is already in the display currency", async () => {
    // The car wash: entered as 25 EUR, stored as 50 AZN. Switching to EUR must
    // show exactly 25.00, not 24.98 after a double conversion.
    const row = {
      amount: "50.00",
      currency: "AZN",
      date: DAY,
      originalAmount: "25.00",
      originalCurrency: "EUR",
    };
    const d = await toDisplayAmount(row, "EUR");
    expect(d.amount).toBe(25);
    expect(d.exact).toBe(true);
  });

  it("passes through when stored and display currency match", async () => {
    const d = await toDisplayAmount({ amount: "12.34", currency: "EUR", date: DAY }, "EUR");
    expect(d).toMatchObject({ amount: 12.34, currency: "EUR", exact: true });
  });

  it("keeps the original currency when no rate is available, rather than lying", async () => {
    const d = await toDisplayAmount({ amount: "70", currency: "GBP", date: DAY }, "EUR");
    expect(d.converted).toBe(false);
    expect(d.currency).toBe("GBP"); // not mislabelled as EUR
    expect(d.amount).toBe(70);
  });

  it("treats currency codes case-insensitively", async () => {
    const d = await toDisplayAmount({ amount: "50", currency: "azn", date: DAY }, "eur");
    expect(d.amount).toBe(25);
  });

  it("converts a list in one call", async () => {
    const out = await toDisplayAmounts(
      [
        { amount: "50", currency: "AZN", date: DAY },
        { amount: "10", currency: "EUR", date: DAY },
      ],
      "EUR"
    );
    expect(out.map((d) => d.amount)).toEqual([25, 10]);
  });
});

describe("sumBuckets", () => {
  it("converts each currency before adding, not after", async () => {
    // 50 AZN + 25 EUR is 50 EUR, never 75.
    const { total } = await sumBuckets(
      [
        { total: "50", currency: "AZN", date: DAY },
        { total: "25", currency: "EUR", date: DAY },
      ],
      "EUR"
    );
    expect(total).toBe(50);
  });

  it("reports buckets it could not convert instead of silently dropping them", async () => {
    const { total, unconvertible } = await sumBuckets(
      [
        { total: "10", currency: "EUR", date: DAY },
        { total: "70", currency: "GBP", date: DAY },
      ],
      "EUR"
    );
    expect(total).toBe(10);
    expect(unconvertible).toHaveLength(1);
  });

  it("looks a rate up once per currency and day", async () => {
    const spy = vi.mocked(rates.tryGetExchangeRate);
    spy.mockClear();
    await sumBuckets(
      [
        { total: "10", currency: "AZN", date: DAY },
        { total: "20", currency: "AZN", date: DAY + 1000 }, // same day
      ],
      "EUR"
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns zero for no buckets", async () => {
    expect((await sumBuckets([], "EUR")).total).toBe(0);
  });
});

describe("batched conversion", () => {
  it("looks a rate up once for many rows sharing a currency and day", async () => {
    // A naive Promise.all fired one request per row, so 50 same-day rows meant
    // 50 identical HTTP calls, each able to stall the list for its timeout.
    const spy = vi.mocked(rates.tryGetExchangeRate);
    spy.mockClear();
    const rows = Array.from({ length: 20 }, () => ({
      amount: "10",
      currency: "AZN",
      date: DAY,
    }));
    const out = await toDisplayAmounts(rows, "EUR");
    expect(out).toHaveLength(20);
    expect(out.every((d) => d.amount === 5)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("needs no rate at all when rows are already in the display currency", async () => {
    const spy = vi.mocked(rates.tryGetExchangeRate);
    spy.mockClear();
    await toDisplayAmounts(
      [
        { amount: "10", currency: "EUR", date: DAY },
        { amount: "50", currency: "AZN", date: DAY, originalAmount: "25", originalCurrency: "EUR" },
      ],
      "EUR"
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps per-row results aligned with their input order", async () => {
    const out = await toDisplayAmounts(
      [
        { amount: "50", currency: "AZN", date: DAY }, // 25 EUR
        { amount: "10", currency: "EUR", date: DAY }, // 10 EUR
        { amount: "70", currency: "GBP", date: DAY }, // no rate
      ],
      "EUR"
    );
    expect(out[0]).toMatchObject({ amount: 25, currency: "EUR" });
    expect(out[1]).toMatchObject({ amount: 10, currency: "EUR" });
    expect(out[2]).toMatchObject({ amount: 70, currency: "GBP", converted: false });
  });
});
