// Startup wrapper: patches globalThis.crypto for jose compatibility on Node.js 18
// jose@6 uses Web Crypto API (globalThis.crypto) which may not be available in some Node.js 18 builds
import { webcrypto } from 'crypto';
import { execSync } from 'child_process';
import mysql from 'mysql2/promise';

// Polyfill globalThis.crypto if not available
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
  console.log('[startup] Patched globalThis.crypto for jose compatibility');
}

// Run database migrations on startup to ensure schema is up-to-date
try {
  console.log('[startup] Running database migrations...');
  execSync('npx drizzle-kit migrate', { stdio: 'inherit', cwd: process.cwd() });
  console.log('[startup] Database migrations complete');
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

// Now start the actual server
await import('./dist/index.js');
