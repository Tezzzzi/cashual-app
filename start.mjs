// Startup wrapper: patches globalThis.crypto for jose compatibility on Node.js 18
// jose@6 uses Web Crypto API (globalThis.crypto) which may not be available in some Node.js 18 builds
import { webcrypto } from 'crypto';
import mysql from 'mysql2/promise';

// Polyfill globalThis.crypto if not available
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
  console.log('[startup] Patched globalThis.crypto for jose compatibility');
}

// Run database migrations on startup via raw SQL (idempotent)
// drizzle-kit is a devDependency not available in production, so we run SQL directly
try {
  if (process.env.DATABASE_URL) {
    console.log('[startup] Running database migrations...');
    const migConn = await mysql.createConnection(process.env.DATABASE_URL);

    // Migration 0003: businessGroups table + isWork/businessGroupId on transactions
    await migConn.execute(`
      CREATE TABLE IF NOT EXISTS \`businessGroups\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`name\` varchar(128) NOT NULL,
        \`icon\` varchar(64) NOT NULL DEFAULT '💼',
        \`color\` varchar(32) NOT NULL DEFAULT '#0ea5e9',
        \`userId\` int NOT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT (now()),
        \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`businessGroups_id\` PRIMARY KEY(\`id\`)
      )
    `);
    console.log('[startup] businessGroups table ensured');

    // Add isWork column if it doesn't exist
    const [isWorkCols] = await migConn.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'isWork'`
    );
    if (isWorkCols.length === 0) {
      await migConn.execute(`ALTER TABLE \`transactions\` ADD \`isWork\` boolean NOT NULL DEFAULT false`);
      console.log('[startup] Added isWork column to transactions');
    }

    // Add businessGroupId column if it doesn't exist
    const [bgCols] = await migConn.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'businessGroupId'`
    );
    if (bgCols.length === 0) {
      await migConn.execute(`ALTER TABLE \`transactions\` ADD \`businessGroupId\` int`);
      console.log('[startup] Added businessGroupId column to transactions');
    }

    await migConn.end();
    console.log('[startup] Database migrations complete');
  }
} catch (err) {
  console.warn('[startup] Migration warning (non-fatal):', err.message);
}

// Fix any transaction dates stored in seconds instead of milliseconds
// Dates in seconds are < 1e11 (before year 5138), dates in ms are > 1e12
try {
  if (process.env.DATABASE_URL) {
    console.log('[startup] Checking for transaction dates stored in seconds...');
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    const [rows] = await conn.execute(
      'UPDATE transactions SET date = date * 1000 WHERE date > 0 AND date < 1000000000000'
    );
    const affected = rows.affectedRows || 0;
    if (affected > 0) {
      console.log(`[startup] Fixed ${affected} transaction dates (seconds → milliseconds)`);
    } else {
      console.log('[startup] All transaction dates are already in milliseconds');
    }
    await conn.end();
  }
} catch (err) {
  console.warn('[startup] Date fix warning (non-fatal):', err.message);
}

// Fix transactions with dates in 2024 that should be in 2026 (LLM training data cutoff issue)
try {
  if (process.env.DATABASE_URL) {
    console.log('[startup] Checking for transactions with wrong year (2024 instead of 2026)...');
    const conn2 = await mysql.createConnection(process.env.DATABASE_URL);
    
    // 2024 range in milliseconds: Jan 1 2024 = 1704067200000, Jan 1 2025 = 1735689600000
    // We need to shift these forward by exactly 2 years (2024 → 2026)
    // The offset is approximately 2 * 365.25 * 86400 * 1000 = 63115200000 ms
    // More precisely: Jan 1 2026 - Jan 1 2024 = 1767225600000 - 1704067200000 = 63158400000
    const year2024Start = 1704067200000; // 2024-01-01T00:00:00.000Z
    const year2025Start = 1735689600000; // 2025-01-01T00:00:00.000Z
    const yearOffset = 63158400000; // difference between 2026-01-01 and 2024-01-01 in ms
    
    const [rows2] = await conn2.execute(
      `UPDATE transactions SET date = date + ${yearOffset} WHERE date >= ${year2024Start} AND date < ${year2025Start}`
    );
    const affected2 = rows2.affectedRows || 0;
    if (affected2 > 0) {
      console.log(`[startup] Fixed ${affected2} transactions from 2024 → 2026`);
    } else {
      console.log('[startup] No transactions with 2024 dates found');
    }
    await conn2.end();
  }
} catch (err) {
  console.warn('[startup] Year fix warning (non-fatal):', err.message);
}

// Clean up inconsistent data: null out businessGroupId on non-work transactions
// This prevents personal transactions with stale businessGroupId from leaking into work reports
try {
  if (process.env.DATABASE_URL) {
    console.log('[startup] Cleaning up stale businessGroupId on non-work transactions...');
    const cleanupConn = await mysql.createConnection(process.env.DATABASE_URL);
    const [cleanupRows] = await cleanupConn.execute(
      'UPDATE transactions SET businessGroupId = NULL WHERE isWork = false AND businessGroupId IS NOT NULL'
    );
    const cleanedUp = cleanupRows.affectedRows || 0;
    if (cleanedUp > 0) {
      console.log(`[startup] Cleaned up ${cleanedUp} transactions with stale businessGroupId`);
    } else {
      console.log('[startup] No stale businessGroupId values found');
    }
    await cleanupConn.end();
  }
} catch (err) {
  console.warn('[startup] businessGroupId cleanup warning (non-fatal):', err.message);
}

// Now start the actual server
await import('./dist/index.js');
