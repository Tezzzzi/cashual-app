// Startup wrapper: patches globalThis.crypto for jose compatibility on Node.js 18
// jose@6 uses Web Crypto API (globalThis.crypto) which may not be available in some Node.js 18 builds
import { webcrypto } from 'crypto';
import { execSync } from 'child_process';

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

// Now start the actual server
await import('./dist/index.js');
