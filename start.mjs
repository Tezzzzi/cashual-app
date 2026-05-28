// Startup wrapper: patches globalThis.crypto for jose compatibility on Node.js 18
// and performs additive-only database safety checks before loading the app.
import { webcrypto } from 'crypto';
import mysql from 'mysql2/promise';

// Polyfill globalThis.crypto if not available
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
  console.log('[startup] Patched globalThis.crypto for jose compatibility');
}

const migrationLog = (message) => console.log(`[startup][safe-migrate] ${message}`);
const migrationWarn = (message, err) => console.warn(`[startup][safe-migrate] ${message}`, err?.message || err || '');

async function tableExists(conn, tableName) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName],
  );
  return rows.length > 0;
}

async function getColumns(conn, tableName) {
  const [rows] = await conn.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName],
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function indexExists(conn, tableName, indexName) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName],
  );
  return rows.length > 0;
}

async function ensureTable(conn, tableName, createSql) {
  if (await tableExists(conn, tableName)) {
    migrationLog(`Table ${tableName} already exists; leaving existing data untouched.`);
    return;
  }
  migrationLog(`Creating missing table ${tableName}.`);
  await conn.execute(createSql);
}

async function ensureColumn(conn, tableName, columnName, addColumnSql) {
  if (!(await tableExists(conn, tableName))) {
    migrationWarn(`Cannot add ${tableName}.${columnName}: table is missing.`);
    return;
  }
  const columns = await getColumns(conn, tableName);
  if (columns.has(columnName)) {
    migrationLog(`Column ${tableName}.${columnName} already exists.`);
    return;
  }
  migrationLog(`Adding missing column ${tableName}.${columnName}.`);
  await conn.execute(addColumnSql);
}

async function ensureUniqueIndex(conn, tableName, indexName, columnName) {
  if (!(await tableExists(conn, tableName))) return;
  if (await indexExists(conn, tableName, indexName)) {
    migrationLog(`Unique index ${indexName} already exists on ${tableName}.`);
    return;
  }
  try {
    migrationLog(`Adding missing unique index ${indexName} on ${tableName}.${columnName}.`);
    await conn.execute(`ALTER TABLE \`${tableName}\` ADD UNIQUE INDEX \`${indexName}\` (\`${columnName}\`)`);
  } catch (err) {
    migrationWarn(
      `Could not add unique index ${indexName}; leaving table unchanged. This is non-fatal and usually means duplicate historical values exist.`,
      err,
    );
  }
}

async function runAdditiveMigrations() {
  if (!process.env.DATABASE_URL) {
    migrationLog('DATABASE_URL is not set; skipping database safety checks.');
    return;
  }

  migrationLog('Starting additive-only schema checks. No DROP/TRUNCATE/DELETE/data rewrite statements are executed.');
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  try {
    await ensureTable(conn, 'users', `
      CREATE TABLE \`users\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`openId\` varchar(64) NOT NULL,
        \`name\` text,
        \`email\` varchar(320),
        \`loginMethod\` varchar(64),
        \`role\` enum('user','admin') NOT NULL DEFAULT 'user',
        \`telegramId\` varchar(64),
        \`telegramUsername\` varchar(128),
        \`telegramFirstName\` varchar(128),
        \`telegramLastName\` varchar(128),
        \`telegramPhotoUrl\` text,
        \`preferredLanguage\` varchar(10) DEFAULT 'ru',
        \`preferredCurrency\` varchar(10) DEFAULT 'AZN',
        \`remindersEnabled\` boolean NOT NULL DEFAULT true,
        \`timezone\` varchar(64),
        \`defaultBudget\` enum('personal','family') DEFAULT 'personal',
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`lastSignedIn\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`users_openId_unique\` (\`openId\`),
        UNIQUE KEY \`users_telegramId_unique\` (\`telegramId\`)
      )
    `);

    await ensureTable(conn, 'categories', `
      CREATE TABLE \`categories\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`name\` varchar(128) NOT NULL,
        \`icon\` varchar(64) NOT NULL DEFAULT '📦',
        \`color\` varchar(32) NOT NULL DEFAULT '#6366f1',
        \`type\` enum('income','expense','both') NOT NULL DEFAULT 'both',
        \`isPreset\` boolean NOT NULL DEFAULT false,
        \`userId\` int,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      )
    `);

    await ensureTable(conn, 'transactions', `
      CREATE TABLE \`transactions\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`userId\` int NOT NULL,
        \`categoryId\` int,
        \`type\` enum('income','expense') NOT NULL DEFAULT 'expense',
        \`amount\` decimal(12,2) NOT NULL,
        \`currency\` varchar(10) NOT NULL DEFAULT 'AZN',
        \`description\` text,
        \`date\` bigint NOT NULL,
        \`isFamily\` boolean NOT NULL DEFAULT false,
        \`familyGroupId\` int,
        \`isWork\` boolean NOT NULL DEFAULT false,
        \`businessGroupId\` int,
        \`originalAmount\` decimal(12,2) DEFAULT NULL,
        \`originalCurrency\` varchar(10) DEFAULT NULL,
        \`exchangeRate\` decimal(16,8) DEFAULT NULL,
        \`sourceLanguage\` varchar(10),
        \`rawTranscription\` text,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      )
    `);

    await ensureTable(conn, 'businessGroups', `
      CREATE TABLE \`businessGroups\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`name\` varchar(128) NOT NULL,
        \`icon\` varchar(64) NOT NULL DEFAULT '💼',
        \`color\` varchar(32) NOT NULL DEFAULT '#0ea5e9',
        \`userId\` int NOT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      )
    `);

    await ensureTable(conn, 'familyGroups', `
      CREATE TABLE \`familyGroups\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`name\` varchar(128) NOT NULL,
        \`icon\` varchar(64) NOT NULL DEFAULT '👨‍👩‍👦',
        \`color\` varchar(32) NOT NULL DEFAULT '#8b5cf6',
        \`inviteCode\` varchar(16),
        \`ownerId\` int NOT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`familyGroups_inviteCode_unique\` (\`inviteCode\`)
      )
    `);

    await ensureTable(conn, 'familyGroupMembers', `
      CREATE TABLE \`familyGroupMembers\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`familyGroupId\` int NOT NULL,
        \`userId\` int NOT NULL,
        \`role\` enum('owner','admin','member') NOT NULL DEFAULT 'member',
        \`joinedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      )
    `);

    await ensureTable(conn, 'familyPermissions', `
      CREATE TABLE \`familyPermissions\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`familyGroupId\` int NOT NULL,
        \`grantorId\` int,
        \`granteeId\` int,
        \`userId\` int,
        \`canViewExpenses\` boolean NOT NULL DEFAULT true,
        \`canViewTransactions\` boolean NOT NULL DEFAULT true,
        \`canAddTransactions\` boolean NOT NULL DEFAULT true,
        \`canEditTransactions\` boolean NOT NULL DEFAULT false,
        \`canDeleteTransactions\` boolean NOT NULL DEFAULT false,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      )
    `);

    const additiveColumns = [
      ['users', 'telegramId', 'ALTER TABLE `users` ADD `telegramId` varchar(64)'],
      ['users', 'telegramUsername', 'ALTER TABLE `users` ADD `telegramUsername` varchar(128)'],
      ['users', 'telegramFirstName', 'ALTER TABLE `users` ADD `telegramFirstName` varchar(128)'],
      ['users', 'telegramLastName', 'ALTER TABLE `users` ADD `telegramLastName` varchar(128)'],
      ['users', 'telegramPhotoUrl', 'ALTER TABLE `users` ADD `telegramPhotoUrl` text'],
      ['users', 'preferredLanguage', "ALTER TABLE `users` ADD `preferredLanguage` varchar(10) DEFAULT 'ru'"],
      ['users', 'preferredCurrency', "ALTER TABLE `users` ADD `preferredCurrency` varchar(10) DEFAULT 'AZN'"],
      ['users', 'remindersEnabled', 'ALTER TABLE `users` ADD `remindersEnabled` boolean NOT NULL DEFAULT true'],
      ['users', 'timezone', 'ALTER TABLE `users` ADD `timezone` varchar(64) DEFAULT NULL'],
      ['users', 'defaultBudget', "ALTER TABLE `users` ADD `defaultBudget` enum('personal','family') DEFAULT 'personal'"],
      ['users', 'createdAt', 'ALTER TABLE `users` ADD `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP'],
      ['users', 'updatedAt', 'ALTER TABLE `users` ADD `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
      ['users', 'lastSignedIn', 'ALTER TABLE `users` ADD `lastSignedIn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP'],

      ['categories', 'icon', "ALTER TABLE `categories` ADD `icon` varchar(64) NOT NULL DEFAULT '📦'"],
      ['categories', 'color', "ALTER TABLE `categories` ADD `color` varchar(32) NOT NULL DEFAULT '#6366f1'"],
      ['categories', 'type', "ALTER TABLE `categories` ADD `type` enum('income','expense','both') NOT NULL DEFAULT 'both'"],
      ['categories', 'isPreset', 'ALTER TABLE `categories` ADD `isPreset` boolean NOT NULL DEFAULT false'],
      ['categories', 'userId', 'ALTER TABLE `categories` ADD `userId` int'],
      ['categories', 'createdAt', 'ALTER TABLE `categories` ADD `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP'],
      ['categories', 'updatedAt', 'ALTER TABLE `categories` ADD `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],

      ['transactions', 'userId', 'ALTER TABLE `transactions` ADD `userId` int'],
      ['transactions', 'categoryId', 'ALTER TABLE `transactions` ADD `categoryId` int'],
      ['transactions', 'type', "ALTER TABLE `transactions` ADD `type` enum('income','expense') NOT NULL DEFAULT 'expense'"],
      ['transactions', 'amount', 'ALTER TABLE `transactions` ADD `amount` decimal(12,2)'],
      ['transactions', 'currency', "ALTER TABLE `transactions` ADD `currency` varchar(10) NOT NULL DEFAULT 'AZN'"],
      ['transactions', 'description', 'ALTER TABLE `transactions` ADD `description` text'],
      ['transactions', 'date', 'ALTER TABLE `transactions` ADD `date` bigint'],
      ['transactions', 'isFamily', 'ALTER TABLE `transactions` ADD `isFamily` boolean NOT NULL DEFAULT false'],
      ['transactions', 'familyGroupId', 'ALTER TABLE `transactions` ADD `familyGroupId` int'],
      ['transactions', 'isWork', 'ALTER TABLE `transactions` ADD `isWork` boolean NOT NULL DEFAULT false'],
      ['transactions', 'businessGroupId', 'ALTER TABLE `transactions` ADD `businessGroupId` int'],
      ['transactions', 'originalAmount', 'ALTER TABLE `transactions` ADD `originalAmount` decimal(12,2) DEFAULT NULL'],
      ['transactions', 'originalCurrency', 'ALTER TABLE `transactions` ADD `originalCurrency` varchar(10) DEFAULT NULL'],
      ['transactions', 'exchangeRate', 'ALTER TABLE `transactions` ADD `exchangeRate` decimal(16,8) DEFAULT NULL'],
      ['transactions', 'sourceLanguage', 'ALTER TABLE `transactions` ADD `sourceLanguage` varchar(10)'],
      ['transactions', 'rawTranscription', 'ALTER TABLE `transactions` ADD `rawTranscription` text'],
      ['transactions', 'createdAt', 'ALTER TABLE `transactions` ADD `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP'],
      ['transactions', 'updatedAt', 'ALTER TABLE `transactions` ADD `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],

      ['businessGroups', 'icon', "ALTER TABLE `businessGroups` ADD `icon` varchar(64) NOT NULL DEFAULT '💼'"],
      ['businessGroups', 'color', "ALTER TABLE `businessGroups` ADD `color` varchar(32) NOT NULL DEFAULT '#0ea5e9'"],
      ['businessGroups', 'createdAt', 'ALTER TABLE `businessGroups` ADD `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP'],
      ['businessGroups', 'updatedAt', 'ALTER TABLE `businessGroups` ADD `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],

      ['familyGroups', 'icon', "ALTER TABLE `familyGroups` ADD `icon` varchar(64) NOT NULL DEFAULT '👨‍👩‍👦'"],
      ['familyGroups', 'color', "ALTER TABLE `familyGroups` ADD `color` varchar(32) NOT NULL DEFAULT '#8b5cf6'"],
      ['familyGroups', 'inviteCode', 'ALTER TABLE `familyGroups` ADD `inviteCode` varchar(16)'],
      ['familyGroups', 'ownerId', 'ALTER TABLE `familyGroups` ADD `ownerId` int'],
      ['familyGroups', 'createdAt', 'ALTER TABLE `familyGroups` ADD `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP'],
      ['familyGroups', 'updatedAt', 'ALTER TABLE `familyGroups` ADD `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],

      ['familyGroupMembers', 'role', "ALTER TABLE `familyGroupMembers` ADD `role` enum('owner','admin','member') NOT NULL DEFAULT 'member'"],
      ['familyGroupMembers', 'joinedAt', 'ALTER TABLE `familyGroupMembers` ADD `joinedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP'],

      ['familyPermissions', 'grantorId', 'ALTER TABLE `familyPermissions` ADD `grantorId` int'],
      ['familyPermissions', 'granteeId', 'ALTER TABLE `familyPermissions` ADD `granteeId` int'],
      ['familyPermissions', 'userId', 'ALTER TABLE `familyPermissions` ADD `userId` int'],
      ['familyPermissions', 'canViewExpenses', 'ALTER TABLE `familyPermissions` ADD `canViewExpenses` boolean NOT NULL DEFAULT true'],
      ['familyPermissions', 'canViewTransactions', 'ALTER TABLE `familyPermissions` ADD `canViewTransactions` boolean NOT NULL DEFAULT true'],
      ['familyPermissions', 'canAddTransactions', 'ALTER TABLE `familyPermissions` ADD `canAddTransactions` boolean NOT NULL DEFAULT true'],
      ['familyPermissions', 'canEditTransactions', 'ALTER TABLE `familyPermissions` ADD `canEditTransactions` boolean NOT NULL DEFAULT false'],
      ['familyPermissions', 'canDeleteTransactions', 'ALTER TABLE `familyPermissions` ADD `canDeleteTransactions` boolean NOT NULL DEFAULT false'],
      ['familyPermissions', 'createdAt', 'ALTER TABLE `familyPermissions` ADD `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP'],
      ['familyPermissions', 'updatedAt', 'ALTER TABLE `familyPermissions` ADD `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
    ];

    for (const [tableName, columnName, sql] of additiveColumns) {
      try {
        await ensureColumn(conn, tableName, columnName, sql);
      } catch (err) {
        migrationWarn(`Could not add ${tableName}.${columnName}; continuing without destructive changes.`, err);
      }
    }

    await ensureUniqueIndex(conn, 'users', 'users_openId_unique', 'openId');
    await ensureUniqueIndex(conn, 'users', 'users_telegramId_unique', 'telegramId');
    await ensureUniqueIndex(conn, 'familyGroups', 'familyGroups_inviteCode_unique', 'inviteCode');

    migrationLog('Additive-only schema checks complete.');
  } finally {
    await conn.end();
  }
}

try {
  await runAdditiveMigrations();
} catch (err) {
  migrationWarn('Database safety checks failed non-fatally; the app will still start.', err);
}

// IMPORTANT: start.mjs intentionally does not run drizzle-kit push/migrate and does not execute
// DROP, TRUNCATE, DELETE, or bulk UPDATE cleanup statements. Data corrections must be reviewed
// and run manually from explicit, audited maintenance scripts after taking a backup.

// Now start the actual server
await import('./dist/index.js');
