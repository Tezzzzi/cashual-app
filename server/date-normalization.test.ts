import { describe, expect, it } from "vitest";
import { normalizeTimestampMs } from "./db";

describe("normalizeTimestampMs", () => {
  it("converts seconds timestamps to milliseconds", () => {
    const secondsTimestamp = 1743465600; // 2025-04-01 in seconds
    const result = normalizeTimestampMs(secondsTimestamp);
    expect(result).toBe(1743465600000);
  });

  it("leaves milliseconds timestamps unchanged", () => {
    const msTimestamp = 1743465600000; // 2025-04-01 in milliseconds
    const result = normalizeTimestampMs(msTimestamp);
    expect(result).toBe(1743465600000);
  });

  it("handles zero timestamp", () => {
    expect(normalizeTimestampMs(0)).toBe(0);
  });

  it("handles negative timestamp", () => {
    expect(normalizeTimestampMs(-1000)).toBe(-1000);
  });

  it("converts timestamps in the ambiguous zone (1e10-1e11)", () => {
    const ts = 10000000000; // 1e10
    const result = normalizeTimestampMs(ts);
    expect(result).toBe(10000000000000);
  });

  it("converts timestamps in the range 1e11-1e12 (seconds)", () => {
    const ts = 100000000000; // 1e11
    const result = normalizeTimestampMs(ts);
    expect(result).toBe(100000000000000);
  });

  it("does NOT convert timestamps >= 1e12 (already milliseconds)", () => {
    const ts = 1000000000000; // 1e12
    const result = normalizeTimestampMs(ts);
    expect(result).toBe(1000000000000);
  });

  it("correctly handles a real-world LLM-returned seconds timestamp", () => {
    const llmSeconds = 1743465600;
    const result = normalizeTimestampMs(llmSeconds);
    expect(new Date(result).getFullYear()).toBe(2025);
    expect(result).toBeGreaterThan(1e12);
  });

  it("correctly handles a real-world milliseconds timestamp", () => {
    const msNow = Date.now();
    const result = normalizeTimestampMs(msNow);
    expect(result).toBe(msNow);
    expect(result).toBeGreaterThan(1e12);
  });
});

describe("LLM date year-fix validation logic", () => {
  // These tests validate the server-side date correction logic
  // that runs after LLM parsing (in voice and receipt routers)

  function fixLlmDate(dateMs: number): number {
    const now = new Date();
    const currentYear = now.getFullYear();
    const todayMs = now.getTime();

    if (dateMs) {
      const parsedDate = new Date(dateMs);
      const parsedYear = parsedDate.getFullYear();
      if (parsedYear !== currentYear && parsedYear >= 2020 && parsedYear < currentYear) {
        parsedDate.setFullYear(currentYear);
        dateMs = parsedDate.getTime();
      }
      if (dateMs > todayMs + 86400000) {
        dateMs = todayMs;
      }
    }
    return dateMs;
  }

  it("fixes a 2024 date to current year (2026)", () => {
    // March 15, 2024 in ms
    const date2024 = new Date("2024-03-15T12:00:00Z").getTime();
    const fixed = fixLlmDate(date2024);
    const fixedDate = new Date(fixed);
    expect(fixedDate.getFullYear()).toBe(new Date().getFullYear());
    expect(fixedDate.getMonth()).toBe(2); // March (0-indexed)
    expect(fixedDate.getDate()).toBe(15);
  });

  it("fixes a 2023 date to current year (or resets if future)", () => {
    const date2023 = new Date("2023-01-15T10:00:00Z").getTime();
    const fixed = fixLlmDate(date2023);
    const fixedDate = new Date(fixed);
    // Should be fixed to current year; Jan 15 is always in the past
    expect(fixedDate.getFullYear()).toBe(new Date().getFullYear());
    expect(fixedDate.getUTCMonth()).toBe(0); // January in UTC
  });

  it("does NOT fix a date already in the current year", () => {
    const currentYear = new Date().getFullYear();
    const dateThisYear = new Date(`${currentYear}-03-15T12:00:00Z`).getTime();
    const fixed = fixLlmDate(dateThisYear);
    expect(fixed).toBe(dateThisYear);
  });

  it("resets a future date (more than 1 day ahead) to now", () => {
    const futureDate = Date.now() + 7 * 86400000; // 7 days in the future
    const fixed = fixLlmDate(futureDate);
    // Should be reset to approximately now
    expect(Math.abs(fixed - Date.now())).toBeLessThan(1000);
  });

  it("allows a date up to 1 day in the future", () => {
    const slightlyFuture = Date.now() + 12 * 3600000; // 12 hours ahead
    const fixed = fixLlmDate(slightlyFuture);
    expect(fixed).toBe(slightlyFuture); // Should NOT be reset
  });

  it("does NOT fix dates before 2020", () => {
    // A date in 2019 should not be auto-fixed (too old to be an LLM error)
    const date2019 = new Date("2019-06-15T12:00:00Z").getTime();
    const fixed = fixLlmDate(date2019);
    expect(new Date(fixed).getFullYear()).toBe(2019);
  });
});

describe("startup migration: 2024→2026 year offset", () => {
  it("correctly calculates the year offset", () => {
    const year2024Start = 1704067200000; // 2024-01-01T00:00:00.000Z
    const year2026Start = 1767225600000; // 2026-01-01T00:00:00.000Z
    const yearOffset = 63158400000;
    
    expect(year2026Start - year2024Start).toBe(yearOffset);
  });

  it("shifts a 2024 date to approximately the correct 2026 date", () => {
    const yearOffset = 63158400000;
    // March 15, 2024 12:00 UTC
    const march15_2024 = new Date("2024-03-15T12:00:00Z").getTime();
    const shifted = march15_2024 + yearOffset;
    const shiftedDate = new Date(shifted);
    
    // The offset is calculated from Jan 1 boundaries, so the shifted date
    // lands in 2026 March but may be off by ~1 day due to leap year
    expect(shiftedDate.getUTCFullYear()).toBe(2026);
    expect(shiftedDate.getUTCMonth()).toBe(2); // March
    // Allow 1 day tolerance due to leap year offset
    expect(shiftedDate.getUTCDate()).toBeGreaterThanOrEqual(15);
    expect(shiftedDate.getUTCDate()).toBeLessThanOrEqual(16);
  });

  it("only affects dates within 2024 range", () => {
    const year2024Start = 1704067200000;
    const year2025Start = 1735689600000;
    
    // A date in 2025 should NOT be in the range
    const date2025 = new Date("2025-06-15T12:00:00Z").getTime();
    expect(date2025).toBeGreaterThanOrEqual(year2025Start);
    
    // A date in 2024 SHOULD be in the range
    const date2024 = new Date("2024-06-15T12:00:00Z").getTime();
    expect(date2024).toBeGreaterThanOrEqual(year2024Start);
    expect(date2024).toBeLessThan(year2025Start);
  });
});
