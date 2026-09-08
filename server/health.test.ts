import { describe, expect, it, beforeEach } from "vitest";
import { checkReadiness } from "./health";
import { readFileSync } from "node:fs";

describe("checkReadiness", () => {
  beforeEach(() => {
    // These tests never reach a real database.
    delete process.env.DATABASE_URL;
  });

  it("reports not-ready when there is no database handle", async () => {
    const result = await checkReadiness();
    expect(result.ok).toBe(false);
    expect(result.checks.database).toBe(false);
    expect(result.checks.schema).toBe(false);
  });

  it("explains the failure in the detail field for logs", async () => {
    const result = await checkReadiness();
    expect(result.detail).toBeTruthy();
    // Regression guard: the original health sketch swallowed errors in an empty
    // catch, destroying the only clue about why the app was unhealthy.
    expect(result.detail).toMatch(/database|connect/i);
  });
});

describe("readiness schema coverage", () => {
  // The 2026-09-05 outage: connection healthy, `users.walletToken` missing,
  // every user query failing, and `/` still returning 200. Readiness must check
  // the columns whose absence caused it, or it will miss the same class of
  // failure again.
  const source = readFileSync(new URL("./health.ts", import.meta.url), "utf8");

  it("checks the column whose absence broke authentication", () => {
    expect(source).toContain('["users", "walletToken"]');
  });

  it("checks the columns the authorization predicate depends on", () => {
    expect(source).toContain('["transactions", "isFamily"]');
    expect(source).toContain('["transactions", "familyGroupId"]');
    expect(source).toContain('["familyGroups", "ownerId"]');
    expect(source).toContain('["familyGroupMembers", "familyGroupId"]');
  });

  it("keeps liveness free of database access", () => {
    // /api/live must not query the database: a database blip should not make an
    // orchestrator restart an otherwise healthy process.
    const liveHandler = source.slice(
      source.indexOf('app.get("/api/live"'),
      source.indexOf('app.get("/api/ready"')
    );
    expect(liveHandler).not.toMatch(/getDb|execute|checkReadiness/);
  });
});
