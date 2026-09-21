# Operations

Written after the 2026-09-04 data loss. Read the "Never again" section before
touching the database or a deployment.

## Never again

**The database must always have a persistent volume.** The MySQL service ran
without one, so its data directory lived in ephemeral container storage. A
billing lapse suspended every service in the account; when payment resumed the
container restarted with an empty data directory and every user, transaction and
family group was gone. Projects whose databases had volumes (`Yoldash.ai`,
`postgres-volume` at `/var/lib/postgresql/data`) came back untouched.

Two independent rules follow:

1. A database without a persistent volume is temporary storage, whatever it is
   called. Verify persistence by experiment — write a row, redeploy, read it
   back — never by reading a dashboard.
2. Backups must live on a **different provider and a different account**. The
   trigger here was account-level billing, so any copy inside the same Railway
   account would have been just as unavailable.

**Never run `drizzle-kit push` or any automatic migration from a build, install
or deploy script.** An earlier incident (May 2026) lost data exactly that way.
`pnpm db:push` deliberately routes to `scripts/refuse-destructive-migrations.mjs`
and refuses to run; that is a guard rail, not a bug.

## Health endpoints

| Endpoint | Answers | Touches DB |
|---|---|---|
| `/api/live` | is the process up? | no |
| `/api/ready` | can this instance serve traffic? | yes — connection **and** schema |

Point external uptime monitoring at `/api/ready`. `/` returned `200` for the
entire 2026-09-05 outage while every query against `users` failed, and a plain
`SELECT 1` check would have returned `200` too — the connection was healthy, the
schema was not. Readiness verifies the columns the core queries and the
authorization predicate depend on; see `REQUIRED_COLUMNS` in `server/health.ts`.

Keep `/api/live` free of database access, or a database blip will make an
orchestrator restart healthy processes.

## Rollback: application and data are separate decisions

**Default rollback is application-only** — redeploy the previous image. This is
safe and repeatable, and it is why schema migrations must be backward compatible
(expand/contract: add compatible structures, ship the app, drop old structures
in a later release after an observation period).

**Point-in-time recovery is not a rollback mechanism.** Rewinding the database
to a moment before a release destroys every legitimate transaction users entered
since then — the cure becomes the disease. PITR is an incident tool only:

1. Estimate what would be lost between the target point and now.
2. Restore the target point into a **temporary branch or database**, never over
   production.
3. Extract only the damaged rows and merge them back.

## Backups

`.github/workflows/backup.yml` runs daily at 03:15 UTC, outside the application
and outside Railway. It takes a consistent `mysqldump --single-transaction`
snapshot, **verifies it by restoring into a clean MySQL and comparing per-table
row counts**, then encrypts (AES256) and uploads to Cloudflare R2. Failure sends
a Telegram alert — a backup that fails silently is worse than none, because it
buys false confidence.

The in-process scheduler that used to live in `server/backup.ts` has been
removed: it kept the dump in the app's memory and the next run in a
`setTimeout`, so nothing durable was written, the copy died with the process,
and a run was skipped entirely whenever the app was down. `generateSqlBackup`
and the admin routes `/api/backup` and `/api/backup/status` remain, for taking
an on-demand dump before a risky operation.

**First verified backup: 2026-09-21** — `cashual/2026/09/21/…sql.gz.gpg`,
51 rows across 8 tables, restored into a clean MySQL and checked. The alert
path was verified the same day by forcing a failure on a throwaway branch.

Alerts reuse the **product** bot's token rather than a separate one. When that
token is rotated — it leaked to the public repo and is due for replacement —
update **both** `TELEGRAM_BOT_TOKEN` in Railway and `TELEGRAM_ALERT_BOT_TOKEN`
in GitHub secrets, or alerts will go quiet without anything appearing to break.

### Required GitHub secrets

| Secret | What |
|---|---|
| `PROD_DATABASE_URL` | MySQL URL via the **public** proxy (`gondola.proxy.rlwy.net:15395`), not `mysql.railway.internal` |
| `BACKUP_ENCRYPTION_PASSPHRASE` | Symmetric passphrase. Store it somewhere that survives losing this repo — without it the backups are unreadable |
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | Bucket name |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token |
| `TELEGRAM_ALERT_BOT_TOKEN` / `TELEGRAM_ALERT_CHAT_ID` | Failure alerts. Use a **different** bot from the product bot |

### Monthly restore drill

Run `workflow_dispatch` on the backup workflow and confirm the restore-verify
step passes, then record the date. The daily run already restores and compares
row counts, so the drill is about confirming *you* can do it under pressure and
that the passphrase is still retrievable.

## Migrations

- Generate with `drizzle-kit generate`, never `push`. Commit the SQL.
- `start.mjs` performs additive-only checks at startup: create missing table,
  add missing column, add missing unique index. No `DROP`, `TRUNCATE`, `DELETE`
  or bulk rewrite runs there.
- Adding a column to `drizzle/schema.ts` is **not enough** — it must also be
  added to the `start.mjs` list, or a fresh database will lack it and every
  query touching that table will fail with `ER_BAD_FIELD_ERROR`. That is exactly
  how `users.walletToken` broke authentication on 2026-09-05.
- Destructive changes require: verified backup → explicit approval → manual
  `ALTER TABLE` → verification.

## Authorization invariant

A user may always mutate their own transactions. A family group **owner** may
additionally mutate **family-budget** rows (`isFamily = true`) of members of a
group they actually own. Personal rows stay private even from the owner.

`buildTransactionMutationFilter` in `server/db.ts` is the single source of truth
and correlates group ownership and author membership against the row's own
`familyGroupId`. `buildMultiUserVisibilityFilter` does the same for reads: own
rows in full, other members' family rows only.

Never authorize on `transaction id` plus a bare `userId` match, and never look a
row up by `id` alone to feed a side effect — the category-learning pre-image did
that and leaked other users' descriptions into the caller's own rules.

## Known gaps

- No foreign keys anywhere in the schema; orphaned rows are possible.
- `familyGroupMembers` has no role column, so "family member except children"
  cannot be expressed yet.
- Secrets were committed to a public repository (OpenAI key, bot token, database
  password). Rotate, then purge history — rewriting history does not revoke a
  leaked credential.
