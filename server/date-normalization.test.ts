import { describe, expect, it } from "vitest";
import { normalizeTimestampMs } from "./db";

describe("normalizeTimestampMs", () => {
  it("converts seconds timestamps to milliseconds", () => {
    // Current epoch in seconds (~1.74e9 for March 2025)
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
    // 1e10 seconds = year 2286, still seconds
    const ts = 10000000000; // 1e10
    const result = normalizeTimestampMs(ts);
    expect(result).toBe(10000000000000); // converted to ms
  });

  it("converts timestamps in the range 1e11-1e12 (seconds)", () => {
    // 1e11 seconds = year ~5138, still treated as seconds by our threshold
    const ts = 100000000000; // 1e11
    const result = normalizeTimestampMs(ts);
    expect(result).toBe(100000000000000); // converted to ms
  });

  it("does NOT convert timestamps >= 1e12 (already milliseconds)", () => {
    // 1e12 ms = year ~2001, already ms
    const ts = 1000000000000; // 1e12
    const result = normalizeTimestampMs(ts);
    expect(result).toBe(1000000000000); // unchanged
  });

  it("correctly handles a real-world LLM-returned seconds timestamp", () => {
    // LLM might return 1743465600 (seconds) instead of 1743465600000 (ms)
    const llmSeconds = 1743465600;
    const result = normalizeTimestampMs(llmSeconds);
    // Should be converted to ms
    expect(new Date(result).getFullYear()).toBe(2025);
    expect(result).toBeGreaterThan(1e12);
  });

  it("correctly handles a real-world milliseconds timestamp", () => {
    const msNow = Date.now(); // ~1.77e12
    const result = normalizeTimestampMs(msNow);
    expect(result).toBe(msNow); // unchanged
    expect(result).toBeGreaterThan(1e12);
  });
});
