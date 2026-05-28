console.error(`
Refusing to run database schema changes from npm scripts.

This project was hardened after a production data-loss incident. Do not run drizzle-kit push
or any automatic migration command from build, install, deploy, or generic npm scripts.

Allowed production behavior:
  - start.mjs performs additive-only CREATE TABLE IF MISSING / ADD COLUMN IF MISSING checks.
  - No DROP, TRUNCATE, DELETE, or bulk UPDATE cleanup runs during startup.

If a human-reviewed migration is required:
  1. Take and verify a fresh SQL backup first.
  2. Review the generated SQL manually.
  3. Run only additive DDL against the intended environment.
  4. Commit the reviewed migration separately.
`);
process.exit(1);
