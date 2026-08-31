import { describe, expect, it, beforeEach } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { buildTransactionMutationFilter } from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * These tests compile the real authorization predicate down to SQL and assert on
 * its shape. That matters because the bug being guarded against lived entirely
 * inside the WHERE clause — a mocked database layer would have happily reported
 * success against the vulnerable version.
 *
 * No test here connects to a database: DATABASE_URL is cleared below so that
 * getDb() returns null and every db helper takes its early-return path.
 */

const TX_ID = 7;
const CALLER_ID = 1;

/** Compiled predicate, lowercased and stripped of backticks for stable matching. */
function compiledFilter(id = TX_ID, userId = CALLER_ID) {
  const filter = buildTransactionMutationFilter(id, userId);
  const query = new MySqlDialect().sqlToQuery(filter!);
  return {
    sql: query.sql.toLowerCase().replace(/`/g, ""),
    params: query.params,
  };
}

describe("buildTransactionMutationFilter", () => {
  it("scopes the row by id and allows the caller's own transaction", () => {
    const { sql, params } = compiledFilter();
    expect(sql).toContain("transactions.id = ?");
    expect(sql).toContain("transactions.userid = ?");
    expect(params).toContain(TX_ID);
    expect(params).toContain(CALLER_ID);
  });

  it("restricts the family-owner branch to family-budget rows", () => {
    const { sql } = compiledFilter();
    expect(sql).toContain("transactions.isfamily = ?");
    expect(sql).toContain("transactions.familygroupid is not null");
  });

  it("requires the caller to own the group the row belongs to", () => {
    const { sql } = compiledFilter();
    // Correlated against the row's own familyGroupId, not a pre-fetched id list.
    expect(sql).toContain("exists (select 1 from familygroups");
    expect(sql).toContain("familygroups.id = transactions.familygroupid");
    expect(sql).toContain("familygroups.ownerid = ?");
  });

  it("requires the row's author to be a member of that same group", () => {
    const { sql } = compiledFilter();
    expect(sql).toContain("exists (select 1 from familygroupmembers");
    expect(sql).toContain(
      "familygroupmembers.familygroupid = transactions.familygroupid"
    );
    expect(sql).toContain("familygroupmembers.userid = transactions.userid");
  });

  it("never authorizes on transaction id plus member userId alone", () => {
    const { sql } = compiledFilter();
    // Regression guard for the original defect: the family branch must always
    // carry both the group-ownership and the group-membership correlation, so a
    // member's personal/work rows and other groups' rows stay out of reach.
    const familyBranch = sql.slice(sql.indexOf("transactions.isfamily"));
    expect(familyBranch).toContain("familygroups.ownerid");
    expect(familyBranch).toContain("familygroupmembers.familygroupid");
  });

  it("binds a different caller's id into the ownership check", () => {
    const { params } = compiledFilter(99, 42);
    expect(params).toContain(99);
    expect(params).toContain(42);
  });
});

function createAuthContext(userId = CALLER_ID): TrpcContext {
  return {
    user: {
      id: userId,
      openId: "test-user-123",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role: "user",
      telegramId: "12345",
      telegramUsername: "testuser",
      telegramFirstName: "Test",
      telegramLastName: "User",
      telegramPhotoUrl: null,
      preferredLanguage: "ru",
      preferredCurrency: "AZN",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("transactions.update / transactions.delete authorization result", () => {
  beforeEach(() => {
    // Guarantees these tests can never reach a real database.
    delete process.env.DATABASE_URL;
  });

  it("reports failure instead of a false success when the row is not authorized", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    // Previously this returned { success: true } even when nothing was updated,
    // hiding both denials and missing rows from the client.
    await expect(
      caller.transactions.update({ id: TX_ID, categoryId: 3 })
    ).rejects.toThrow(/not found/i);
  });

  it("reports failure instead of a false success on an unauthorized delete", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    await expect(caller.transactions.delete({ id: TX_ID })).rejects.toThrow(
      /not found/i
    );
  });

  it("does not create a category rule when the update was not authorized", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    // The pre-image is now fetched through the authorized predicate, so an
    // unauthorized id cannot seed a rule from someone else's description.
    await expect(
      caller.transactions.update({
        id: TX_ID,
        categoryId: 3,
        description: "leaked",
      })
    ).rejects.toThrow(/not found/i);
  });
});
