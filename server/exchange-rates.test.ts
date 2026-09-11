import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { tryGetExchangeRate, getExchangeRate } from "./exchange-rates";

/**
 * `fetchRates` substitutes hardcoded approximate rates whenever the network
 * fails, so it always returns something. The strict lookup used for anything
 * shown to a user must reject those: presenting a guess as a converted amount
 * is the same class of lie as relabelling the currency without converting.
 */

const originalFetch = global.fetch;

/** Every rate source unreachable — the case that forces the fallback table. */
function breakNetwork() {
  global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as any;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("tryGetExchangeRate (strict)", () => {
  it("returns null when only approximate fallback rates are available", async () => {
    breakNetwork();
    // AZN→EUR exists in the fallback table, so the loose lookup would answer.
    const rate = await tryGetExchangeRate("AZN", "EUR", Date.parse("2026-09-01"));
    expect(rate).toBeNull();
  });

  it("still answers 1 for an identical currency without any lookup", async () => {
    breakNetwork();
    expect(await tryGetExchangeRate("EUR", "EUR")).toBe(1);
  });

  it("returns null for a currency the fallback table does not know", async () => {
    breakNetwork();
    // CHF is absent from the table. It previously defaulted to a 1.0 USD rate,
    // so CHF was silently converted as if it were dollars.
    expect(await tryGetExchangeRate("CHF", "EUR")).toBeNull();
  });
});

describe("getExchangeRate (loose, used when recording)", () => {
  it("still falls back to an approximate rate so an expense can be saved", async () => {
    breakNetwork();
    const rate = await getExchangeRate("AZN", "EUR");
    // Deliberately non-null: refusing to record the user's expense because a
    // rate provider is down would be worse than storing an approximation.
    expect(rate).toBeGreaterThan(0);
  });
});
