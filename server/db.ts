import { eq, and, sql, desc, gte, lte, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  categories,
  transactions,
  familyGroups,
  familyGroupMembers,
  familyPermissions,
  type InsertCategory,
  type InsertTransaction,
  type InsertFamilyGroup,
  type InsertFamilyGroupMember,
  type InsertFamilyPermission,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ───────────────────────────────────────────────────────────

/**
 * Create or update a user. Handles all fields including Telegram-specific ones.
 */
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    // Build the full values object - include every defined field
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};

    // All nullable string fields
    const stringFields = [
      "name", "email", "loginMethod",
      "telegramId", "telegramUsername", "telegramFirstName",
      "telegramLastName", "telegramPhotoUrl",
      "preferredLanguage", "preferredCurrency",
    ] as const;

    for (const field of stringFields) {
      const value = user[field as keyof InsertUser];
      if (value === undefined) continue;
      const normalized = value ?? null;
      (values as any)[field] = normalized;
      updateSet[field] = normalized;
    }

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
    console.log("[Database] Upserted user:", user.openId, "telegramId:", user.telegramId);
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByTelegramId(telegramId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateUserTelegram(
  userId: number,
  data: {
    telegramId?: string;
    telegramUsername?: string;
    telegramFirstName?: string;
    telegramLastName?: string;
    telegramPhotoUrl?: string;
    preferredLanguage?: string;
    preferredCurrency?: string;
  }
) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set(data).where(eq(users.id, userId));
}

// ─── Categories ──────────────────────────────────────────────────────
export async function getCategories(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(categories)
    .where(
      sql`${categories.isPreset} = true OR ${categories.userId} = ${userId}`
    );
}

export async function createCategory(data: InsertCategory) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(categories).values(data).$returningId();
  return result;
}

export async function deleteCategory(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(categories)
    .where(and(eq(categories.id, id), eq(categories.userId, userId), eq(categories.isPreset, false)));
}

export async function seedPresetCategories() {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(categories).where(eq(categories.isPreset, true));
  if (existing.length > 0) return;

  const presets: InsertCategory[] = [
    { name: "Продукты", icon: "🛒", color: "#22c55e", type: "expense", isPreset: true },
    { name: "Транспорт", icon: "🚗", color: "#3b82f6", type: "expense", isPreset: true },
    { name: "Жильё", icon: "🏠", color: "#8b5cf6", type: "expense", isPreset: true },
    { name: "Развлечения", icon: "🎬", color: "#f59e0b", type: "expense", isPreset: true },
    { name: "Здоровье", icon: "💊", color: "#ef4444", type: "expense", isPreset: true },
    { name: "Одежда", icon: "👕", color: "#ec4899", type: "expense", isPreset: true },
    { name: "Образование", icon: "📚", color: "#06b6d4", type: "expense", isPreset: true },
    { name: "Рестораны", icon: "🍽️", color: "#f97316", type: "expense", isPreset: true },
    { name: "Связь", icon: "📱", color: "#6366f1", type: "expense", isPreset: true },
    { name: "Подписки", icon: "📺", color: "#a855f7", type: "expense", isPreset: true },
    { name: "Подарки", icon: "🎁", color: "#e11d48", type: "expense", isPreset: true },
    { name: "Зарплата", icon: "💰", color: "#10b981", type: "income", isPreset: true },
    { name: "Фриланс", icon: "💻", color: "#14b8a6", type: "income", isPreset: true },
    { name: "Инвестиции", icon: "📈", color: "#0ea5e9", type: "income", isPreset: true },
    { name: "Другое", icon: "📦", color: "#78716c", type: "both", isPreset: true },
  ];
  await db.insert(categories).values(presets);
}

// ─── Timestamp Normalization ────────────────────────────────────────
/**
 * Ensures a timestamp is in milliseconds.
 * Current epoch in seconds: ~1.74e9 (Mar 2025)
 * Current epoch in milliseconds: ~1.74e12
 * Threshold: anything < 1e12 is treated as seconds.
 * This safely covers seconds timestamps up to year ~33658.
 */
export function normalizeTimestampMs(ts: number): number {
  if (ts > 0 && ts < 1e12) {
    // Definitely seconds — convert to milliseconds
    return ts * 1000;
  }
  return ts;
}

// ─── Transactions ────────────────────────────────────────────────────
export async function getTransactions(
  userId: number,
  opts?: {
    familyGroupId?: number;
    isFamily?: boolean;
    startDate?: number;
    endDate?: number;
    type?: "income" | "expense";
    categoryId?: number;
    limit?: number;
    offset?: number;
  }
) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];

  if (opts?.familyGroupId) {
    conditions.push(eq(transactions.familyGroupId, opts.familyGroupId));
    conditions.push(eq(transactions.isFamily, true));
  } else if (opts?.isFamily === false) {
    conditions.push(eq(transactions.userId, userId));
    conditions.push(eq(transactions.isFamily, false));
  } else {
    conditions.push(eq(transactions.userId, userId));
  }

  if (opts?.startDate) conditions.push(gte(transactions.date, opts.startDate));
  if (opts?.endDate) conditions.push(lte(transactions.date, opts.endDate));
  if (opts?.type) conditions.push(eq(transactions.type, opts.type));
  if (opts?.categoryId) conditions.push(eq(transactions.categoryId, opts.categoryId));

  return db
    .select({
      transaction: transactions,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      categoryColor: categories.color,
      userName: users.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(users, eq(transactions.userId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(transactions.date))
    .limit(opts?.limit ?? 100)
    .offset(opts?.offset ?? 0);
}

export async function createTransaction(data: InsertTransaction) {
  const db = await getDb();
  if (!db) return null;
  // Normalize date to milliseconds before storing
  const normalizedData = { ...data, date: normalizeTimestampMs(data.date) };
  const [result] = await db.insert(transactions).values(normalizedData).$returningId();
  return result;
}

export async function updateTransaction(
  id: number,
  userId: number,
  data: Partial<InsertTransaction>
) {
  const db = await getDb();
  if (!db) return;
  // Normalize date to milliseconds if present
  const normalizedData = data.date ? { ...data, date: normalizeTimestampMs(data.date) } : data;
  await db
    .update(transactions)
    .set(normalizedData)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
}

export async function deleteTransaction(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
}

// ─── Reports ─────────────────────────────────────────────────────────
export async function getReportSummary(
  userId: number,
  opts?: { startDate?: number; endDate?: number; familyGroupId?: number; userIds?: number[] }
) {
  const db = await getDb();
  if (!db) return { totalIncome: 0, totalExpense: 0, balance: 0 };

  const conditions = [];

  if (opts?.familyGroupId && opts?.userIds && opts.userIds.length > 0) {
    // Family shared reports: filter by family group + specific user IDs
    conditions.push(eq(transactions.familyGroupId, opts.familyGroupId));
    conditions.push(eq(transactions.isFamily, true));
    conditions.push(inArray(transactions.userId, opts.userIds));
  } else if (opts?.familyGroupId) {
    // Filter by specific family group (all members)
    conditions.push(eq(transactions.familyGroupId, opts.familyGroupId));
    conditions.push(eq(transactions.isFamily, true));
  } else {
    // Show ALL transactions belonging to this user (personal + family)
    conditions.push(eq(transactions.userId, userId));
  }

  if (opts?.startDate) conditions.push(gte(transactions.date, opts.startDate));
  if (opts?.endDate) conditions.push(lte(transactions.date, opts.endDate));

  const result = await db
    .select({
      type: transactions.type,
      total: sql<string>`CAST(SUM(${transactions.amount}) AS CHAR)`,
    })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(transactions.type);

  let totalIncome = 0;
  let totalExpense = 0;
  for (const row of result) {
    if (row.type === "income") totalIncome = parseFloat(row.total || "0");
    if (row.type === "expense") totalExpense = parseFloat(row.total || "0");
  }

  return { totalIncome, totalExpense, balance: totalIncome - totalExpense };
}

export async function getReportByCategory(
  userId: number,
  opts?: { startDate?: number; endDate?: number; familyGroupId?: number; type?: "income" | "expense"; userIds?: number[] }
) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];

  if (opts?.familyGroupId && opts?.userIds && opts.userIds.length > 0) {
    // Family shared reports: filter by family group + specific user IDs
    conditions.push(eq(transactions.familyGroupId, opts.familyGroupId));
    conditions.push(eq(transactions.isFamily, true));
    conditions.push(inArray(transactions.userId, opts.userIds));
  } else if (opts?.familyGroupId) {
    // Filter by specific family group (all members)
    conditions.push(eq(transactions.familyGroupId, opts.familyGroupId));
    conditions.push(eq(transactions.isFamily, true));
  } else {
    // Show ALL transactions belonging to this user (personal + family)
    conditions.push(eq(transactions.userId, userId));
  }

  if (opts?.startDate) conditions.push(gte(transactions.date, opts.startDate));
  if (opts?.endDate) conditions.push(lte(transactions.date, opts.endDate));
  if (opts?.type) conditions.push(eq(transactions.type, opts.type));

  return db
    .select({
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      categoryColor: categories.color,
      total: sql<string>`CAST(SUM(${transactions.amount}) AS CHAR)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(...conditions))
    .groupBy(transactions.categoryId, categories.name, categories.icon, categories.color)
    .orderBy(desc(sql`SUM(${transactions.amount})`));
}

export async function getReportByPeriod(
  userId: number,
  opts?: { startDate?: number; endDate?: number; familyGroupId?: number }
) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];

  if (opts?.familyGroupId) {
    // Filter by specific family group
    conditions.push(eq(transactions.familyGroupId, opts.familyGroupId));
    conditions.push(eq(transactions.isFamily, true));
  } else {
    // Show ALL transactions belonging to this user (personal + family)
    conditions.push(eq(transactions.userId, userId));
  }

  if (opts?.startDate) conditions.push(gte(transactions.date, opts.startDate));
  if (opts?.endDate) conditions.push(lte(transactions.date, opts.endDate));

  return db
    .select({
      type: transactions.type,
      month: sql<string>`DATE_FORMAT(FROM_UNIXTIME(${transactions.date}/1000), '%Y-%m')`,
      total: sql<string>`CAST(SUM(${transactions.amount}) AS CHAR)`,
    })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(transactions.type, sql`DATE_FORMAT(FROM_UNIXTIME(${transactions.date}/1000), '%Y-%m')`)
    .orderBy(sql`DATE_FORMAT(FROM_UNIXTIME(${transactions.date}/1000), '%Y-%m')`);
}

/**
 * Fix any existing transactions that have dates stored in seconds instead of milliseconds.
 * This is a one-time migration that runs on startup.
 */
export async function fixTransactionDates() {
  const db = await getDb();
  if (!db) return;
  try {
    // Any date value less than 1e11 is definitely in seconds (before year 5138 in seconds)
    // Multiply by 1000 to convert to milliseconds
    const result = await db.execute(
      sql`UPDATE transactions SET date = date * 1000 WHERE date > 0 AND date < 1000000000000`
    );
    console.log("[Database] Fixed transaction dates (seconds → milliseconds)");
  } catch (error) {
    console.error("[Database] Failed to fix transaction dates:", error);
  }
}

// ─── Family Groups ────────────────────────────────────────────────────
export async function createFamilyGroup(data: InsertFamilyGroup) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(familyGroups).values(data).$returningId();
  return result;
}

export async function getFamilyGroupByInviteCode(inviteCode: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(familyGroups)
    .where(eq(familyGroups.inviteCode, inviteCode))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getFamilyGroupsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ group: familyGroups })
    .from(familyGroupMembers)
    .innerJoin(familyGroups, eq(familyGroupMembers.familyGroupId, familyGroups.id))
    .where(eq(familyGroupMembers.userId, userId));
}

export async function addFamilyGroupMember(data: InsertFamilyGroupMember) {
  const db = await getDb();
  if (!db) return;
  // Check if already a member
  const existing = await db
    .select()
    .from(familyGroupMembers)
    .where(
      and(
        eq(familyGroupMembers.familyGroupId, data.familyGroupId),
        eq(familyGroupMembers.userId, data.userId)
      )
    )
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(familyGroupMembers).values(data);
}

export async function removeFamilyGroupMember(familyGroupId: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(familyGroupMembers)
    .where(
      and(
        eq(familyGroupMembers.familyGroupId, familyGroupId),
        eq(familyGroupMembers.userId, userId)
      )
    );
}

export async function getFamilyGroupMembers(familyGroupId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ member: familyGroupMembers, user: users })
    .from(familyGroupMembers)
    .innerJoin(users, eq(familyGroupMembers.userId, users.id))
    .where(eq(familyGroupMembers.familyGroupId, familyGroupId));
}

// Aliases for backward compatibility with routers.ts
export async function joinFamilyGroup(familyGroupId: number, userId: number) {
  return addFamilyGroupMember({ familyGroupId, userId });
}
export const leaveFamilyGroup = removeFamilyGroupMember;

export async function isGroupMember(familyGroupId: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db
    .select()
    .from(familyGroupMembers)
    .where(
      and(
        eq(familyGroupMembers.familyGroupId, familyGroupId),
        eq(familyGroupMembers.userId, userId)
      )
    )
    .limit(1);
  return result.length > 0;
}

// ─── Family Permissions ─────────────────────────────────────────────

/**
 * Get all permissions for a specific family group.
 * Returns who has granted view access to whom.
 */
export async function getFamilyPermissions(familyGroupId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(familyPermissions)
    .where(eq(familyPermissions.familyGroupId, familyGroupId));
}

/**
 * Get permissions that a specific user (grantor) has set.
 * Shows who can see this user's expenses.
 */
export async function getMyPermissions(familyGroupId: number, grantorId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(familyPermissions)
    .where(
      and(
        eq(familyPermissions.familyGroupId, familyGroupId),
        eq(familyPermissions.grantorId, grantorId)
      )
    );
}

/**
 * Set or update a permission: grantor allows/denies grantee to view expenses.
 */
export async function setFamilyPermission(
  familyGroupId: number,
  grantorId: number,
  granteeId: number,
  canViewExpenses: boolean
) {
  const db = await getDb();
  if (!db) return;

  // Check if permission already exists
  const existing = await db
    .select()
    .from(familyPermissions)
    .where(
      and(
        eq(familyPermissions.familyGroupId, familyGroupId),
        eq(familyPermissions.grantorId, grantorId),
        eq(familyPermissions.granteeId, granteeId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(familyPermissions)
      .set({ canViewExpenses })
      .where(eq(familyPermissions.id, existing[0].id));
  } else {
    await db.insert(familyPermissions).values({
      familyGroupId,
      grantorId,
      granteeId,
      canViewExpenses,
    });
  }
}

/**
 * Get the list of user IDs whose expenses the given viewer can see
 * within a specific family group.
 * If no permissions are set for a grantor, default is VISIBLE (opt-out model).
 */
export async function getViewableUserIds(
  familyGroupId: number,
  viewerId: number
): Promise<number[]> {
  const db = await getDb();
  if (!db) return [viewerId];

  // Get all members of the group
  const members = await db
    .select({ userId: familyGroupMembers.userId })
    .from(familyGroupMembers)
    .where(eq(familyGroupMembers.familyGroupId, familyGroupId));

  const allMemberIds = members.map((m) => m.userId);

  // Get all permissions where the viewer is the grantee
  const perms = await db
    .select()
    .from(familyPermissions)
    .where(
      and(
        eq(familyPermissions.familyGroupId, familyGroupId),
        eq(familyPermissions.granteeId, viewerId)
      )
    );

  // Build a set of explicitly denied grantors
  const deniedGrantors = new Set<number>();
  for (const p of perms) {
    if (!p.canViewExpenses) {
      deniedGrantors.add(p.grantorId);
    }
  }

  // Default: all members are visible unless explicitly denied
  return allMemberIds.filter((id) => !deniedGrantors.has(id));
}

/**
 * Initialize default permissions when a new member joins a family group.
 * By default, all existing members grant the new member view access,
 * and the new member grants all existing members view access.
 */
export async function initializePermissionsForNewMember(
  familyGroupId: number,
  newMemberId: number
) {
  const db = await getDb();
  if (!db) return;

  const members = await db
    .select({ userId: familyGroupMembers.userId })
    .from(familyGroupMembers)
    .where(eq(familyGroupMembers.familyGroupId, familyGroupId));

  for (const member of members) {
    if (member.userId === newMemberId) continue;
    // New member grants existing members access
    await setFamilyPermission(familyGroupId, newMemberId, member.userId, true);
    // Existing members grant new member access
    await setFamilyPermission(familyGroupId, member.userId, newMemberId, true);
  }
}
