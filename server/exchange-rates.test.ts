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

describe("historical lookups never silently use today's rates", () => {
  // The rate cache is module-level with a 24h TTL and survives vi.resetModules,
  // so each case uses its own date to avoid reading another's cached entry.
  it("requests the dated path from both sources", async () => {
    const urls: string[] = [];
    global.fetch = vi.fn(async (url: any) => {
      urls.push(String(url));
      throw new Error("offline");
    }) as any;

    await tryGetExchangeRate("AZN", "EUR", Date.parse("2025-03-04T00:00:00Z"));

    // The fallback used to point at `@latest`, so an outage of the dated
    // endpoint converted old transactions at the current rate.
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u).toContain("2025-03-04");
      expect(u).not.toContain("@latest");
      expect(u).not.toContain("//latest.");
    }
  });

  it("rejects a response whose date is not the one requested", async () => {
    // A CDN can serve a different snapshot than the URL asked for.
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ date: "2026-09-17", azn: { eur: 0.5 } }),
    })) as any;

    const rate = await tryGetExchangeRate("AZN", "EUR", Date.parse("2025-03-05T00:00:00Z"));
    expect(rate).toBeNull();
  });

  it("accepts a response whose date matches", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ date: "2025-03-06", azn: { eur: 0.5 } }),
    })) as any;

    const rate = await tryGetExchangeRate("AZN", "EUR", Date.parse("2025-03-06T00:00:00Z"));
    expect(rate).toBe(0.5);
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
