import { eq, and, sql, desc, gte, lte, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  categories,
  transactions,
  familyGroups,
  familyGroupMembers,
  type InsertCategory,
  type InsertTransaction,
  type InsertFamilyGroup,
  type InsertFamilyGroupMember,
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
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);

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
    // personal only
    conditions.push(eq(transactions.userId, userId));
    conditions.push(eq(transactions.isFamily, false));
  } else {
    // default: user's personal transactions
    conditions.push(eq(transactions.userId, userId));
  }

  if (opts?.startDate) conditions.push(gte(transactions.date, opts.startDate));
  if (opts?.endDate) conditions.push(lte(transactions.date, opts.endDate));
  if (opts?.type) conditions.push(eq(transactions.type, opts.type));
  if (opts?.categoryId) conditions.push(eq(transactions.categoryId, opts.categoryId));

  let query = db
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

  return query;
}

export async function createTransaction(data: InsertTransaction) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(transactions).values(data).$returningId();
  return result;
}

export async function updateTransaction(
  id: number,
  userId: number,
  data: Partial<InsertTransaction>
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(transactions)
    .set(data)
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
  opts?: { startDate?: number; endDate?: number; familyGroupId?: number }
) {
  const db = await getDb();
  if (!db) return { totalIncome: 0, totalExpense: 0, balance: 0 };

  const conditions = [];

  if (opts?.familyGroupId) {
    conditions.push(eq(transactions.familyGroupId, opts.familyGroupId));
    conditions.push(eq(transactions.isFamily, true));
  } else {
    conditions.push(eq(transactions.userId, userId));
    conditions.push(eq(transactions.isFamily, false));
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
  opts?: { startDate?: number; endDate?: number; familyGroupId?: number; type?: "income" | "expense" }
) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];

  if (opts?.familyGroupId) {
    conditions.push(eq(transactions.familyGroupId, opts.familyGroupId));
    conditions.push(eq(transactions.isFamily, true));
  } else {
    conditions.push(eq(transactions.userId, userId));
    conditions.push(eq(transactions.isFamily, false));
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
      type: transactions.type,
      total: sql<string>`CAST(SUM(${transactions.amount}) AS CHAR)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(...conditions))
    .groupBy(transactions.categoryId, categories.name, categories.icon, categories.color, transactions.type);
}

// ─── Family Groups ───────────────────────────────────────────────────
export async function createFamilyGroup(data: InsertFamilyGroup) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(familyGroups).values(data).$returningId();
  // Add owner as member
  await db.insert(familyGroupMembers).values({
    familyGroupId: result.id,
    userId: data.ownerId,
  });
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

export async function getUserFamilyGroups(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      group: familyGroups,
      memberCount: sql<number>`(SELECT COUNT(*) FROM familyGroupMembers WHERE familyGroupId = ${familyGroups.id})`,
    })
    .from(familyGroupMembers)
    .innerJoin(familyGroups, eq(familyGroupMembers.familyGroupId, familyGroups.id))
    .where(eq(familyGroupMembers.userId, userId));
}

export async function joinFamilyGroup(familyGroupId: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  // Check if already member
  const existing = await db
    .select()
    .from(familyGroupMembers)
    .where(
      and(
        eq(familyGroupMembers.familyGroupId, familyGroupId),
        eq(familyGroupMembers.userId, userId)
      )
    )
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(familyGroupMembers).values({ familyGroupId, userId });
}

export async function leaveFamilyGroup(familyGroupId: number, userId: number) {
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
    .select({
      member: familyGroupMembers,
      userName: users.name,
      telegramFirstName: users.telegramFirstName,
    })
    .from(familyGroupMembers)
    .innerJoin(users, eq(familyGroupMembers.userId, users.id))
    .where(eq(familyGroupMembers.familyGroupId, familyGroupId));
}

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
