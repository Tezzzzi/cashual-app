import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  bigint,
  boolean,
  decimal,
} from "drizzle-orm/mysql-core";

// ─── Users ───────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  // Telegram-specific fields
  telegramId: varchar("telegramId", { length: 64 }).unique(),
  telegramUsername: varchar("telegramUsername", { length: 128 }),
  telegramFirstName: varchar("telegramFirstName", { length: 128 }),
  telegramLastName: varchar("telegramLastName", { length: 128 }),
  telegramPhotoUrl: text("telegramPhotoUrl"),
  preferredLanguage: varchar("preferredLanguage", { length: 10 }).default("ru"),
  preferredCurrency: varchar("preferredCurrency", { length: 10 }).default("AZN"),
  defaultBudget: mysqlEnum("defaultBudget", ["personal", "family"]).default("personal"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Categories ──────────────────────────────────────────────────────
export const categories = mysqlTable("categories", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  icon: varchar("icon", { length: 64 }).notNull().default("📦"),
  color: varchar("color", { length: 32 }).notNull().default("#6366f1"),
  type: mysqlEnum("type", ["income", "expense", "both"]).default("both").notNull(),
  isPreset: boolean("isPreset").default(false).notNull(),
  userId: int("userId"), // null = preset (global), non-null = user-created
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Category = typeof categories.$inferSelect;
export type InsertCategory = typeof categories.$inferInsert;

// ─── Transactions ────────────────────────────────────────────────────
export const transactions = mysqlTable("transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  categoryId: int("categoryId").notNull(),
  type: mysqlEnum("type", ["income", "expense"]).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("AZN").notNull(),
  description: text("description"),
  date: bigint("date", { mode: "number" }).notNull(), // UTC timestamp ms
  isFamily: boolean("isFamily").default(false).notNull(),
  familyGroupId: int("familyGroupId"), // null = personal
  isWork: boolean("isWork").default(false).notNull(), // tagged as business/work expense
  businessGroupId: int("businessGroupId"), // null = not a business expense
  originalAmount: decimal("originalAmount", { precision: 12, scale: 2 }), // amount in original currency
  originalCurrency: varchar("originalCurrency", { length: 10 }), // original currency code
  exchangeRate: decimal("exchangeRate", { precision: 16, scale: 8 }), // conversion rate used
  sourceLanguage: varchar("sourceLanguage", { length: 10 }), // detected language
  rawTranscription: text("rawTranscription"), // original voice text
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = typeof transactions.$inferInsert;

// ─── Business Groups (Company Workspaces) ───────────────────────────
export const businessGroups = mysqlTable("businessGroups", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(), // e.g. "Company ABC", "Freelance Project X"
  icon: varchar("icon", { length: 64 }).notNull().default("💼"),
  color: varchar("color", { length: 32 }).notNull().default("#0ea5e9"),
  userId: int("userId").notNull(), // owner
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BusinessGroup = typeof businessGroups.$inferSelect;
export type InsertBusinessGroup = typeof businessGroups.$inferInsert;

// ─── Family Groups ───────────────────────────────────────────────────
export const familyGroups = mysqlTable("familyGroups", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  inviteCode: varchar("inviteCode", { length: 16 }).notNull().unique(),
  ownerId: int("ownerId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FamilyGroup = typeof familyGroups.$inferSelect;
export type InsertFamilyGroup = typeof familyGroups.$inferInsert;

// ─── Family Group Members ────────────────────────────────────────────
export const familyGroupMembers = mysqlTable("familyGroupMembers", {
  id: int("id").autoincrement().primaryKey(),
  familyGroupId: int("familyGroupId").notNull(),
  userId: int("userId").notNull(),
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
});

export type FamilyGroupMember = typeof familyGroupMembers.$inferSelect;
export type InsertFamilyGroupMember = typeof familyGroupMembers.$inferInsert;

// ─── Family Permissions ─────────────────────────────────────────────
// Controls who can see whose expenses within a family group.
// grantor = the person whose expenses are being shared
// grantee = the person who can view those expenses
export const familyPermissions = mysqlTable("familyPermissions", {
  id: int("id").autoincrement().primaryKey(),
  familyGroupId: int("familyGroupId").notNull(),
  grantorId: int("grantorId").notNull(), // user who owns the expenses
  granteeId: int("granteeId").notNull(), // user who can view them
  canViewExpenses: boolean("canViewExpenses").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FamilyPermission = typeof familyPermissions.$inferSelect;
export type InsertFamilyPermission = typeof familyPermissions.$inferInsert;
