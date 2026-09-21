import type express from "express";
import mysql from "mysql2/promise";
import { escape, escapeId } from "mysql2";
import { verifySessionToken } from "./_core/telegram-auth";
import { getUserById } from "./db";

type BackupMetadata = {
  generatedAt: string;
  filename: string;
  tableCount: number;
  rowCount: number;
  bytes: number;
  reason: string;
};

type BackupState = BackupMetadata & {
  sql: string;
};

let lastBackup: BackupState | null = null;
let backupInProgress: Promise<BackupState> | null = null;

function readBearerOrCookieToken(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7).trim();
  }

  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  for (const rawCookie of cookieHeader.split(";")) {
    const eqIdx = rawCookie.indexOf("=");
    if (eqIdx <= 0) continue;
    const name = rawCookie.substring(0, eqIdx).trim();
    if (name !== "cashual_session") continue;
    const value = rawCookie.substring(eqIdx + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

async function requireAdmin(req: express.Request) {
  const token = readBearerOrCookieToken(req);
  const session = verifySessionToken(token);
  if (!session) return null;
  const user = await getUserById(session.userId);
  if (!user || user.role !== "admin") return null;
  return user;
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
  if (value instanceof Date) return escape(value.toISOString().slice(0, 19).replace("T", " "));
  return escape(value as any);
}

function chunkRows<T>(rows: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push(rows.slice(i, i + chunkSize));
  }
  return chunks;
}

export async function generateSqlBackup(reason = "manual"): Promise<BackupState> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured; cannot generate database backup.");
  }

  if (backupInProgress) {
    return backupInProgress;
  }

  backupInProgress = (async () => {
    const generatedAt = new Date().toISOString();
    const filename = `cashual-backup-${generatedAt.replace(/[:.]/g, "-")}.sql`;
    const conn = await mysql.createConnection(databaseUrl);

    try {
      const [dbRows] = await conn.query<any[]>("SELECT DATABASE() AS databaseName");
      const databaseName = dbRows[0]?.databaseName ?? "cashual";
      const [tableRows] = await conn.query<any[]>(
        `SELECT TABLE_NAME AS tableName
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
         ORDER BY TABLE_NAME`,
      );

      const statements: string[] = [];
      let totalRows = 0;

      statements.push("-- Cashual App SQL data backup");
      statements.push(`-- Generated at: ${generatedAt}`);
      statements.push(`-- Reason: ${reason}`);
      statements.push(`-- Database: ${databaseName}`);
      statements.push("-- Contains data INSERT statements only; it does not DROP, TRUNCATE, or CREATE tables.");
      statements.push("SET FOREIGN_KEY_CHECKS=0;");
      statements.push("START TRANSACTION;");
      statements.push("");

      for (const { tableName } of tableRows) {
        const [columnRows] = await conn.query<any[]>(`SHOW COLUMNS FROM ${escapeId(tableName)}`);
        const columnNames = columnRows.map((column) => column.Field as string);
        const [rows] = await conn.query<any[]>(`SELECT * FROM ${escapeId(tableName)}`);
        totalRows += rows.length;

        statements.push(`-- Table: ${tableName}; rows: ${rows.length}`);
        if (rows.length === 0) {
          statements.push("");
          continue;
        }

        const columnList = columnNames.map((columnName) => escapeId(columnName)).join(", ");
        for (const rowChunk of chunkRows(rows, 250)) {
          const values = rowChunk
            .map((row) => `(${columnNames.map((columnName) => sqlValue(row[columnName])).join(", ")})`)
            .join(",\n");
          statements.push(`INSERT INTO ${escapeId(tableName)} (${columnList}) VALUES\n${values};`);
        }
        statements.push("");
      }

      statements.push("COMMIT;");
      statements.push("SET FOREIGN_KEY_CHECKS=1;");
      statements.push("");

      const sql = statements.join("\n");
      const state: BackupState = {
        generatedAt,
        filename,
        tableCount: tableRows.length,
        rowCount: totalRows,
        bytes: Buffer.byteLength(sql, "utf8"),
        reason,
        sql,
      };
      lastBackup = state;
      console.log(
        `[backup] Generated ${filename}: ${state.tableCount} tables, ${state.rowCount} rows, ${state.bytes} bytes (${reason})`,
      );
      return state;
    } finally {
      await conn.end();
      backupInProgress = null;
    }
  })();

  return backupInProgress;
}

export function getLastBackupMetadata(): BackupMetadata | null {
  if (!lastBackup) return null;
  const { sql: _sql, ...metadata } = lastBackup;
  return metadata;
}

export function registerBackupRoute(app: express.Express) {
  app.get("/api/backup", async (req, res) => {
    try {
      const adminUser = await requireAdmin(req);
      if (!adminUser) {
        return res.status(403).json({ error: "Forbidden", message: "Admin access is required." });
      }

      const shouldRefresh = req.query.refresh === "1" || req.query.refresh === "true";
      const backup = shouldRefresh || !lastBackup ? await generateSqlBackup("admin-download") : lastBackup;

      res.setHeader("Content-Type", "application/sql; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=\"${backup.filename}\"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(backup.sql);
      console.log(`[backup] Admin user ${adminUser.id} downloaded ${backup.filename}`);
    } catch (error) {
      console.error("[backup] Failed to serve /api/backup:", error);
      res.status(500).json({ error: "Backup failed", message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/backup/status", async (req, res) => {
    try {
      const adminUser = await requireAdmin(req);
      if (!adminUser) {
        return res.status(403).json({ error: "Forbidden", message: "Admin access is required." });
      }
      res.json({ lastBackup: getLastBackupMetadata(), inProgress: Boolean(backupInProgress) });
    } catch (error) {
      res.status(500).json({ error: "Backup status failed", message: error instanceof Error ? error.message : String(error) });
    }
  });
}

/**
 * The daily scheduler that used to live here has been removed.
 *
 * It was never a backup mechanism: it held the dump in this process's memory
 * and the next run in a setTimeout, so nothing was written anywhere durable,
 * the copy died with the process, and a run was skipped entirely whenever the
 * app was down — including the day the database was wiped, when a backup was
 * most needed.
 *
 * Backups now run in .github/workflows/backup.yml: outside the application and
 * outside Railway, taking a consistent mysqldump, proving it restores into a
 * clean MySQL, encrypting it and uploading to R2, with an alert on failure.
 * Keeping a second, weaker mechanism alongside it would only invite the
 * assumption that the app is protecting itself.
 *
 * generateSqlBackup and the admin route below remain, for taking an on-demand
 * dump before a risky operation.
 */
