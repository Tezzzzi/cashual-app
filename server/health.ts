import type express from "express";
import { sql } from "drizzle-orm";
import { getDb } from "./db";

/**
 * Liveness vs readiness.
 *
 * `/api/live` answers "is the process up?" — it must never touch the database,
 * otherwise a database blip would make an orchestrator kill a healthy process.
 *
 * `/api/ready` answers "can this instance actually serve traffic?" and therefore
 * verifies the schema, not just the connection. A plain `SELECT 1` would have
 * reported healthy throughout the 2026-09-05 incident: the connection was fine
 * while every query against `users` failed with ER_BAD_FIELD_ERROR because the
 * `walletToken` column was missing. Connectivity is not readiness.
 */

/** Columns that must exist for the app's core queries to work at all. */
const REQUIRED_COLUMNS: Array<[table: string, column: string]> = [
  ["users", "walletToken"],
  ["users", "telegramId"],
  ["users", "defaultBudget"],
  ["transactions", "isFamily"],
  ["transactions", "familyGroupId"],
  ["transactions", "isWork"],
  ["familyGroups", "ownerId"],
  ["familyGroupMembers", "familyGroupId"],
];

type ReadyResult = {
  ok: boolean;
  checks: { database: boolean; schema: boolean };
  /** Populated only in logs — never returned to the caller. */
  detail?: string;
};

export async function checkReadiness(): Promise<ReadyResult> {
  const db = await getDb();
  if (!db) {
    return {
      ok: false,
      checks: { database: false, schema: false },
      detail: "no database handle (DATABASE_URL unset or connection failed)",
    };
  }

  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    return {
      ok: false,
      checks: { database: false, schema: false },
      detail: `connectivity failed: ${(err as Error).message}`,
    };
  }

  try {
    const rows = await db.execute(sql`
      SELECT TABLE_NAME AS t, COLUMN_NAME AS c
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
    `);
    const present = new Set<string>();
    for (const row of (rows as any)[0] ?? []) {
      present.add(`${row.t}.${row.c}`);
    }

    const missing = REQUIRED_COLUMNS.filter(([t, c]) => !present.has(`${t}.${c}`)).map(
      ([t, c]) => `${t}.${c}`
    );

    if (missing.length > 0) {
      return {
        ok: false,
        checks: { database: true, schema: false },
        detail: `schema drift, missing: ${missing.join(", ")}`,
      };
    }

    return { ok: true, checks: { database: true, schema: true } };
  } catch (err) {
    return {
      ok: false,
      checks: { database: true, schema: false },
      detail: `schema check failed: ${(err as Error).message}`,
    };
  }
}

export function registerHealthRoutes(app: express.Express) {
  app.get("/api/live", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get("/api/ready", async (_req, res) => {
    const result = await checkReadiness();
    if (!result.ok) {
      // Structured reason goes to logs; the response stays free of internals so
      // it is safe to point an external uptime monitor at this endpoint.
      console.error("[health] not ready:", result.detail);
    }
    res.status(result.ok ? 200 : 503).json({ ok: result.ok, checks: result.checks });
  });
}
