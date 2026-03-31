// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// server/_core/telegram-auth.ts
import crypto from "crypto";
import jwt from "jsonwebtoken";

// server/db.ts
import { eq, and, sql, desc, gte, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  bigint,
  boolean,
  decimal
} from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var categories = mysqlTable("categories", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  icon: varchar("icon", { length: 64 }).notNull().default("\u{1F4E6}"),
  color: varchar("color", { length: 32 }).notNull().default("#6366f1"),
  type: mysqlEnum("type", ["income", "expense", "both"]).default("both").notNull(),
  isPreset: boolean("isPreset").default(false).notNull(),
  userId: int("userId"),
  // null = preset (global), non-null = user-created
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var transactions = mysqlTable("transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  categoryId: int("categoryId").notNull(),
  type: mysqlEnum("type", ["income", "expense"]).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("AZN").notNull(),
  description: text("description"),
  date: bigint("date", { mode: "number" }).notNull(),
  // UTC timestamp ms
  isFamily: boolean("isFamily").default(false).notNull(),
  familyGroupId: int("familyGroupId"),
  // null = personal
  sourceLanguage: varchar("sourceLanguage", { length: 10 }),
  // detected language
  rawTranscription: text("rawTranscription"),
  // original voice text
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var familyGroups = mysqlTable("familyGroups", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  inviteCode: varchar("inviteCode", { length: 16 }).notNull().unique(),
  ownerId: int("ownerId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var familyGroupMembers = mysqlTable("familyGroupMembers", {
  id: int("id").autoincrement().primaryKey(),
  familyGroupId: int("familyGroupId").notNull(),
  userId: int("userId").notNull(),
  joinedAt: timestamp("joinedAt").defaultNow().notNull()
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Telegram & OpenAI
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? ""
};

// server/db.ts
var _db = null;
async function getDb() {
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
async function upsertUser(user) {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = { openId: user.openId };
    const updateSet = {};
    const stringFields = [
      "name",
      "email",
      "loginMethod",
      "telegramId",
      "telegramUsername",
      "telegramFirstName",
      "telegramLastName",
      "telegramPhotoUrl",
      "preferredLanguage",
      "preferredCurrency"
    ];
    for (const field of stringFields) {
      const value = user[field];
      if (value === void 0) continue;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    }
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = /* @__PURE__ */ new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
    console.log("[Database] Upserted user:", user.openId, "telegramId:", user.telegramId);
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getUserById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getUserByTelegramId(telegramId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function updateUserTelegram(userId, data) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set(data).where(eq(users.id, userId));
}
async function getCategories(userId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(categories).where(
    sql`${categories.isPreset} = true OR ${categories.userId} = ${userId}`
  );
}
async function createCategory(data) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(categories).values(data).$returningId();
  return result;
}
async function deleteCategory(id, userId) {
  const db = await getDb();
  if (!db) return;
  await db.delete(categories).where(and(eq(categories.id, id), eq(categories.userId, userId), eq(categories.isPreset, false)));
}
async function seedPresetCategories() {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(categories).where(eq(categories.isPreset, true));
  if (existing.length > 0) return;
  const presets = [
    { name: "\u041F\u0440\u043E\u0434\u0443\u043A\u0442\u044B", icon: "\u{1F6D2}", color: "#22c55e", type: "expense", isPreset: true },
    { name: "\u0422\u0440\u0430\u043D\u0441\u043F\u043E\u0440\u0442", icon: "\u{1F697}", color: "#3b82f6", type: "expense", isPreset: true },
    { name: "\u0416\u0438\u043B\u044C\u0451", icon: "\u{1F3E0}", color: "#8b5cf6", type: "expense", isPreset: true },
    { name: "\u0420\u0430\u0437\u0432\u043B\u0435\u0447\u0435\u043D\u0438\u044F", icon: "\u{1F3AC}", color: "#f59e0b", type: "expense", isPreset: true },
    { name: "\u0417\u0434\u043E\u0440\u043E\u0432\u044C\u0435", icon: "\u{1F48A}", color: "#ef4444", type: "expense", isPreset: true },
    { name: "\u041E\u0434\u0435\u0436\u0434\u0430", icon: "\u{1F455}", color: "#ec4899", type: "expense", isPreset: true },
    { name: "\u041E\u0431\u0440\u0430\u0437\u043E\u0432\u0430\u043D\u0438\u0435", icon: "\u{1F4DA}", color: "#06b6d4", type: "expense", isPreset: true },
    { name: "\u0420\u0435\u0441\u0442\u043E\u0440\u0430\u043D\u044B", icon: "\u{1F37D}\uFE0F", color: "#f97316", type: "expense", isPreset: true },
    { name: "\u0421\u0432\u044F\u0437\u044C", icon: "\u{1F4F1}", color: "#6366f1", type: "expense", isPreset: true },
    { name: "\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0438", icon: "\u{1F4FA}", color: "#a855f7", type: "expense", isPreset: true },
    { name: "\u041F\u043E\u0434\u0430\u0440\u043A\u0438", icon: "\u{1F381}", color: "#e11d48", type: "expense", isPreset: true },
    { name: "\u0417\u0430\u0440\u043F\u043B\u0430\u0442\u0430", icon: "\u{1F4B0}", color: "#10b981", type: "income", isPreset: true },
    { name: "\u0424\u0440\u0438\u043B\u0430\u043D\u0441", icon: "\u{1F4BB}", color: "#14b8a6", type: "income", isPreset: true },
    { name: "\u0418\u043D\u0432\u0435\u0441\u0442\u0438\u0446\u0438\u0438", icon: "\u{1F4C8}", color: "#0ea5e9", type: "income", isPreset: true },
    { name: "\u0414\u0440\u0443\u0433\u043E\u0435", icon: "\u{1F4E6}", color: "#78716c", type: "both", isPreset: true }
  ];
  await db.insert(categories).values(presets);
}
async function getTransactions(userId, opts) {
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
  return db.select({
    transaction: transactions,
    categoryName: categories.name,
    categoryIcon: categories.icon,
    categoryColor: categories.color,
    userName: users.name
  }).from(transactions).leftJoin(categories, eq(transactions.categoryId, categories.id)).leftJoin(users, eq(transactions.userId, users.id)).where(conditions.length > 0 ? and(...conditions) : void 0).orderBy(desc(transactions.date)).limit(opts?.limit ?? 100).offset(opts?.offset ?? 0);
}
async function createTransaction(data) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(transactions).values(data).$returningId();
  return result;
}
async function updateTransaction(id, userId, data) {
  const db = await getDb();
  if (!db) return;
  await db.update(transactions).set(data).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
}
async function deleteTransaction(id, userId) {
  const db = await getDb();
  if (!db) return;
  await db.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
}
async function getReportSummary(userId, opts) {
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
  const result = await db.select({
    type: transactions.type,
    total: sql`CAST(SUM(${transactions.amount}) AS CHAR)`
  }).from(transactions).where(and(...conditions)).groupBy(transactions.type);
  let totalIncome = 0;
  let totalExpense = 0;
  for (const row of result) {
    if (row.type === "income") totalIncome = parseFloat(row.total || "0");
    if (row.type === "expense") totalExpense = parseFloat(row.total || "0");
  }
  return { totalIncome, totalExpense, balance: totalIncome - totalExpense };
}
async function getReportByCategory(userId, opts) {
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
  return db.select({
    categoryId: transactions.categoryId,
    categoryName: categories.name,
    categoryIcon: categories.icon,
    categoryColor: categories.color,
    total: sql`CAST(SUM(${transactions.amount}) AS CHAR)`,
    count: sql`COUNT(*)`
  }).from(transactions).leftJoin(categories, eq(transactions.categoryId, categories.id)).where(and(...conditions)).groupBy(transactions.categoryId, categories.name, categories.icon, categories.color).orderBy(desc(sql`SUM(${transactions.amount})`));
}
async function createFamilyGroup(data) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(familyGroups).values(data).$returningId();
  return result;
}
async function getFamilyGroupByInviteCode(inviteCode) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(familyGroups).where(eq(familyGroups.inviteCode, inviteCode)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getFamilyGroupsByUserId(userId) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ group: familyGroups }).from(familyGroupMembers).innerJoin(familyGroups, eq(familyGroupMembers.familyGroupId, familyGroups.id)).where(eq(familyGroupMembers.userId, userId));
}
async function addFamilyGroupMember(data) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(familyGroupMembers).where(
    and(
      eq(familyGroupMembers.familyGroupId, data.familyGroupId),
      eq(familyGroupMembers.userId, data.userId)
    )
  ).limit(1);
  if (existing.length > 0) return;
  await db.insert(familyGroupMembers).values(data);
}
async function removeFamilyGroupMember(familyGroupId, userId) {
  const db = await getDb();
  if (!db) return;
  await db.delete(familyGroupMembers).where(
    and(
      eq(familyGroupMembers.familyGroupId, familyGroupId),
      eq(familyGroupMembers.userId, userId)
    )
  );
}
async function getFamilyGroupMembers(familyGroupId) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ member: familyGroupMembers, user: users }).from(familyGroupMembers).innerJoin(users, eq(familyGroupMembers.userId, users.id)).where(eq(familyGroupMembers.familyGroupId, familyGroupId));
}
async function joinFamilyGroup(familyGroupId, userId) {
  return addFamilyGroupMember({ familyGroupId, userId });
}
var leaveFamilyGroup = removeFamilyGroupMember;
async function isGroupMember(familyGroupId, userId) {
  const db = await getDb();
  if (!db) return false;
  const result = await db.select().from(familyGroupMembers).where(
    and(
      eq(familyGroupMembers.familyGroupId, familyGroupId),
      eq(familyGroupMembers.userId, userId)
    )
  ).limit(1);
  return result.length > 0;
}

// server/_core/telegram-auth.ts
var ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1e3;
function validateTelegramInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) {
      console.warn("[Telegram] No hash in initData");
      return null;
    }
    params.delete("hash");
    const dataCheckString = Array.from(params).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
    const secretKey = crypto.createHmac("sha256", "WebAppData").update(ENV.telegramBotToken).digest();
    const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    if (computedHash !== hash) {
      console.warn("[Telegram] Invalid hash. Expected:", computedHash, "Got:", hash);
      return null;
    }
    const data = {};
    params.forEach((value, key) => {
      data[key] = value;
    });
    return data;
  } catch (error) {
    console.error("[Telegram] Failed to validate initData:", error);
    return null;
  }
}
function parseTelegramUser(data) {
  try {
    const userJson = data.user;
    if (!userJson) {
      console.warn("[Telegram] No user field in initData");
      return null;
    }
    const user = JSON.parse(userJson);
    const telegramId = String(user.id);
    if (!telegramId || telegramId === "undefined") {
      console.warn("[Telegram] user.id is missing:", user);
      return null;
    }
    return {
      telegramId,
      telegramUsername: user.username || null,
      telegramFirstName: user.first_name || null,
      telegramLastName: user.last_name || null,
      telegramPhotoUrl: user.photo_url || null
    };
  } catch (error) {
    console.error("[Telegram] Failed to parse user data:", error);
    return null;
  }
}
function createSessionToken(userId, telegramId, options = {}) {
  const expiresInSeconds = Math.floor((options.expiresInMs ?? ONE_YEAR_MS) / 1e3);
  const secret = ENV.cookieSecret;
  return jwt.sign(
    { userId, telegramId },
    secret,
    { expiresIn: expiresInSeconds, algorithm: "HS256" }
  );
}
function verifySessionToken(token) {
  if (!token) {
    return null;
  }
  try {
    const secret = ENV.cookieSecret;
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
    const { userId, telegramId } = payload;
    if (typeof userId !== "number" || typeof telegramId !== "string") {
      console.warn("[Auth] Invalid session payload types:", typeof userId, typeof telegramId);
      return null;
    }
    return { userId, telegramId };
  } catch (error) {
    console.warn("[Auth] Session verification failed:", String(error));
    return null;
  }
}

// server/_core/telegram-routes.ts
function registerTelegramRoutes(app) {
  app.post("/api/telegram/auth", async (req, res) => {
    try {
      const { initData } = req.body;
      if (!initData || typeof initData !== "string") {
        console.warn("[Telegram Auth] Missing or invalid initData");
        return res.status(400).json({ error: "Missing or invalid initData" });
      }
      console.log("[Telegram Auth] Received initData length:", initData.length);
      console.log("[Telegram Auth] initData preview:", initData.substring(0, 100));
      const data = validateTelegramInitData(initData);
      if (!data) {
        console.warn("[Telegram Auth] Signature validation failed");
        return res.status(401).json({ error: "Invalid Telegram signature" });
      }
      const telegramUser = parseTelegramUser(data);
      if (!telegramUser) {
        console.warn("[Telegram Auth] Failed to parse user from data:", JSON.stringify(data));
        return res.status(400).json({ error: "Failed to parse user data" });
      }
      console.log("[Telegram Auth] Parsed user:", telegramUser.telegramId, telegramUser.telegramFirstName);
      let user = await getUserByTelegramId(telegramUser.telegramId);
      if (!user) {
        console.log("[Telegram Auth] Creating new user for telegramId:", telegramUser.telegramId);
        const openId = `telegram_${telegramUser.telegramId}`;
        await upsertUser({
          openId,
          name: telegramUser.telegramFirstName || telegramUser.telegramUsername || "User",
          email: null,
          loginMethod: "telegram",
          telegramId: telegramUser.telegramId,
          telegramUsername: telegramUser.telegramUsername ?? void 0,
          telegramFirstName: telegramUser.telegramFirstName ?? void 0,
          telegramLastName: telegramUser.telegramLastName ?? void 0,
          telegramPhotoUrl: telegramUser.telegramPhotoUrl ?? void 0,
          preferredLanguage: "ru",
          preferredCurrency: "AZN",
          lastSignedIn: /* @__PURE__ */ new Date()
        });
        user = await getUserByTelegramId(telegramUser.telegramId);
        if (!user) {
          user = await getUserByOpenId(openId);
        }
      } else {
        console.log("[Telegram Auth] Found existing user id:", user.id);
        await updateUserTelegram(user.id, {
          telegramUsername: telegramUser.telegramUsername ?? void 0,
          telegramFirstName: telegramUser.telegramFirstName ?? void 0,
          telegramLastName: telegramUser.telegramLastName ?? void 0,
          telegramPhotoUrl: telegramUser.telegramPhotoUrl ?? void 0
        });
      }
      if (!user) {
        console.error("[Telegram Auth] Failed to create or retrieve user for telegramId:", telegramUser.telegramId);
        return res.status(500).json({ error: "Failed to create or retrieve user" });
      }
      const sessionToken = createSessionToken(user.id, telegramUser.telegramId);
      console.log("[Telegram Auth] Success for user id:", user.id);
      return res.json({
        success: true,
        token: sessionToken,
        user: {
          id: user.id,
          name: user.name,
          telegramId: user.telegramId,
          preferredLanguage: user.preferredLanguage,
          preferredCurrency: user.preferredCurrency
        }
      });
    } catch (error) {
      console.error("[Telegram Auth] Unhandled error:", error);
      return res.status(500).json({ error: "Authentication failed", details: String(error) });
    }
  });
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  });
}

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS2 = 1e3 * 60 * 60 * 24 * 365;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers.ts
import { TRPCError as TRPCError3 } from "@trpc/server";
import { z as z2 } from "zod";
import { nanoid } from "nanoid";

// server/_core/openai-whisper.ts
async function transcribeAudio(options) {
  try {
    const apiUrl = getTranscriptionApiUrl();
    const apiKey = getTranscriptionApiKey();
    if (!apiUrl || !apiKey) {
      console.error("[Whisper] No API credentials available. forgeApiUrl:", !!ENV.forgeApiUrl, "forgeApiKey:", !!ENV.forgeApiKey, "openaiApiKey:", !!ENV.openaiApiKey);
      return {
        error: "Transcription service is not configured",
        code: "SERVICE_ERROR",
        details: "Neither BUILT_IN_FORGE_API_URL nor OPENAI_API_KEY is set"
      };
    }
    const sizeMB = options.audioBuffer.length / (1024 * 1024);
    if (sizeMB > 16) {
      return {
        error: "Audio file exceeds maximum size limit",
        code: "FILE_TOO_LARGE",
        details: `File size is ${sizeMB.toFixed(2)}MB, maximum allowed is 16MB`
      };
    }
    console.log(`[Whisper] Transcribing ${sizeMB.toFixed(2)}MB audio via ${apiUrl}`);
    const formData = new FormData();
    const mimeType = options.mimeType || "audio/webm";
    const ext = getFileExtension(mimeType);
    const audioBlob = new Blob([new Uint8Array(options.audioBuffer)], { type: mimeType });
    formData.append("file", audioBlob, `audio.${ext}`);
    formData.append("model", "whisper-1");
    if (options.language) {
      formData.append("language", options.language);
    }
    const prompt = options.language === "ru" ? "\u042D\u0442\u043E \u0444\u0438\u043D\u0430\u043D\u0441\u043E\u0432\u0430\u044F \u0442\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u044F. \u0420\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u0439 \u0441\u0443\u043C\u043C\u0443, \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044E \u0438 \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435." : options.language === "az" ? "Bu maliyy\u0259 \u0259m\u0259liyyat\u0131d\u0131r. M\u0259bl\u0259\u011F, kateqoriya v\u0259 t\u0259sviri tan\u0131." : "This is a financial transaction. Recognize the amount, category, and description.";
    formData.append("prompt", prompt);
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Accept-Encoding": "identity"
      },
      body: formData
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(`[Whisper] API error: ${response.status} ${response.statusText} - ${errorText}`);
      return {
        error: "Transcription service request failed",
        code: "TRANSCRIPTION_FAILED",
        details: `${response.status} ${response.statusText}${errorText ? `: ${errorText}` : ""}`
      };
    }
    const result = await response.json();
    console.log(`[Whisper] Transcription successful: "${result.text.substring(0, 50)}..."`);
    const detectedLanguage = result.language || options.language || "ru";
    return {
      text: result.text,
      language: detectedLanguage
    };
  } catch (error) {
    console.error("[Whisper] Unexpected error:", error);
    return {
      error: "Voice transcription failed",
      code: "SERVICE_ERROR",
      details: error instanceof Error ? error.message : "An unexpected error occurred"
    };
  }
}
function getTranscriptionApiUrl() {
  if (ENV.forgeApiUrl && ENV.forgeApiKey) {
    const baseUrl = ENV.forgeApiUrl.endsWith("/") ? ENV.forgeApiUrl : `${ENV.forgeApiUrl}/`;
    return `${baseUrl}v1/audio/transcriptions`;
  }
  if (ENV.openaiApiKey) {
    return "https://api.openai.com/v1/audio/transcriptions";
  }
  return null;
}
function getTranscriptionApiKey() {
  if (ENV.forgeApiUrl && ENV.forgeApiKey) {
    return ENV.forgeApiKey;
  }
  if (ENV.openaiApiKey) {
    return ENV.openaiApiKey;
  }
  return null;
}
function getFileExtension(mimeType) {
  const mimeToExt = {
    "audio/webm": "webm",
    "audio/mp3": "mp3",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
    "audio/m4a": "m4a",
    "audio/mp4": "m4a"
  };
  return mimeToExt[mimeType] || "webm";
}

// server/_core/openai-llm.ts
function getLLMApiUrl() {
  if (ENV.forgeApiUrl && ENV.forgeApiKey) {
    const baseUrl = ENV.forgeApiUrl.endsWith("/") ? ENV.forgeApiUrl : `${ENV.forgeApiUrl}/`;
    return `${baseUrl}v1/chat/completions`;
  }
  return "https://api.openai.com/v1/chat/completions";
}
function getLLMApiKey() {
  if (ENV.forgeApiUrl && ENV.forgeApiKey) {
    return ENV.forgeApiKey;
  }
  if (ENV.openaiApiKey) {
    return ENV.openaiApiKey;
  }
  return null;
}
async function invokeLLM(params) {
  const apiKey = getLLMApiKey();
  const apiUrl = getLLMApiUrl();
  if (!apiKey) {
    console.error("[LLM] No API credentials available. forgeApiUrl:", !!ENV.forgeApiUrl, "forgeApiKey:", !!ENV.forgeApiKey, "openaiApiKey:", !!ENV.openaiApiKey);
    throw new Error("No LLM API credentials configured (neither BUILT_IN_FORGE_API_KEY nor OPENAI_API_KEY)");
  }
  console.log(`[LLM] Calling ${apiUrl}`);
  const payload = {
    model: "gemini-2.5-flash",
    messages: params.messages,
    max_tokens: 4096
  };
  if (params.response_format) {
    payload.response_format = params.response_format;
  }
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[LLM] API error: ${response.status} ${response.statusText} \u2013 ${errorText}`);
    throw new Error(
      `LLM API error: ${response.status} ${response.statusText} \u2013 ${errorText}`
    );
  }
  const result = await response.json();
  console.log(`[LLM] Success, response length: ${result.choices?.[0]?.message?.content?.length || 0}`);
  return result;
}

// server/routers.ts
seedPresetCategories().catch(console.error);
var categoriesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return getCategories(ctx.user.id);
  }),
  create: protectedProcedure.input(
    z2.object({
      name: z2.string().min(1).max(128),
      icon: z2.string().default("\u{1F4E6}"),
      color: z2.string().default("#6366f1"),
      type: z2.enum(["income", "expense", "both"]).default("both")
    })
  ).mutation(async ({ ctx, input }) => {
    return createCategory({
      ...input,
      userId: ctx.user.id,
      isPreset: false
    });
  }),
  delete: protectedProcedure.input(z2.object({ id: z2.number() })).mutation(async ({ ctx, input }) => {
    await deleteCategory(input.id, ctx.user.id);
    return { success: true };
  })
});
var transactionsRouter = router({
  list: protectedProcedure.input(
    z2.object({
      familyGroupId: z2.number().optional(),
      isFamily: z2.boolean().optional(),
      startDate: z2.number().optional(),
      endDate: z2.number().optional(),
      type: z2.enum(["income", "expense"]).optional(),
      categoryId: z2.number().optional(),
      limit: z2.number().min(1).max(500).default(100),
      offset: z2.number().min(0).default(0)
    }).optional()
  ).query(async ({ ctx, input }) => {
    if (input?.familyGroupId) {
      const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
      if (!isMember) throw new TRPCError3({ code: "FORBIDDEN", message: "Not a group member" });
    }
    return getTransactions(ctx.user.id, input ?? void 0);
  }),
  create: protectedProcedure.input(
    z2.object({
      categoryId: z2.number(),
      type: z2.enum(["income", "expense"]),
      amount: z2.string(),
      currency: z2.string().default("AZN"),
      description: z2.string().optional(),
      date: z2.number(),
      isFamily: z2.boolean().default(false),
      familyGroupId: z2.number().optional().nullable(),
      sourceLanguage: z2.string().optional(),
      rawTranscription: z2.string().optional()
    })
  ).mutation(async ({ ctx, input }) => {
    if (input.isFamily && input.familyGroupId) {
      const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
      if (!isMember) throw new TRPCError3({ code: "FORBIDDEN", message: "Not a group member" });
    }
    return createTransaction({
      ...input,
      userId: ctx.user.id,
      familyGroupId: input.familyGroupId ?? null
    });
  }),
  update: protectedProcedure.input(
    z2.object({
      id: z2.number(),
      categoryId: z2.number().optional(),
      type: z2.enum(["income", "expense"]).optional(),
      amount: z2.string().optional(),
      currency: z2.string().optional(),
      description: z2.string().optional(),
      date: z2.number().optional(),
      isFamily: z2.boolean().optional(),
      familyGroupId: z2.number().optional().nullable()
    })
  ).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;
    await updateTransaction(id, ctx.user.id, data);
    return { success: true };
  }),
  delete: protectedProcedure.input(z2.object({ id: z2.number() })).mutation(async ({ ctx, input }) => {
    await deleteTransaction(input.id, ctx.user.id);
    return { success: true };
  })
});
var voiceRouter = router({
  transcribeAndParse: protectedProcedure.input(
    z2.object({
      audioBase64: z2.string(),
      language: z2.string().optional(),
      mimeType: z2.string().optional()
    })
  ).mutation(async ({ ctx, input }) => {
    const audioBuffer = Buffer.from(input.audioBase64, "base64");
    const transcription = await transcribeAudio({
      audioBuffer,
      language: input.language,
      mimeType: input.mimeType
    });
    if ("error" in transcription) {
      throw new TRPCError3({
        code: "BAD_REQUEST",
        message: transcription.error,
        cause: transcription
      });
    }
    const userCategories = await getCategories(ctx.user.id);
    const categoryNames = userCategories.map((c) => c.name).join(", ");
    const now = /* @__PURE__ */ new Date();
    const llmResult = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a financial transaction parser. Extract structured data from the user's voice transcription.
Available categories: ${categoryNames}
Current date: ${now.toISOString()}
User's preferred currency: ${ctx.user.preferredCurrency || "AZN"}

Rules:
- Determine if it's income or expense from context
- Match to the closest available category name
- Extract the amount (number only)
- Determine the currency (default: ${ctx.user.preferredCurrency || "AZN"})
- Create a short description
- If no specific date mentioned, use today
- Detect the language of the transcription (ru, az, en)`
        },
        {
          role: "user",
          content: `Parse this transcription into a financial transaction: "${transcription.text}"`
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "parsed_transaction",
          strict: true,
          schema: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["income", "expense"], description: "Transaction type" },
              amount: { type: "number", description: "Transaction amount" },
              currency: { type: "string", description: "Currency code (AZN, USD, EUR, RUB, etc.)" },
              categoryName: { type: "string", description: "Best matching category name from the available list" },
              description: { type: "string", description: "Short description of the transaction" },
              date: { type: "number", description: "Unix timestamp in milliseconds" },
              language: { type: "string", description: "Detected language code (ru, az, en)" }
            },
            required: ["type", "amount", "currency", "categoryName", "description", "date", "language"],
            additionalProperties: false
          }
        }
      }
    });
    const content = llmResult.choices[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: "Failed to parse transaction" });
    }
    const parsed = JSON.parse(content);
    const matchedCategory = userCategories.find(
      (c) => c.name.toLowerCase() === parsed.categoryName.toLowerCase()
    ) || userCategories.find((c) => c.name.toLowerCase().includes(parsed.categoryName.toLowerCase())) || userCategories[userCategories.length - 1];
    return {
      transcription: transcription.text,
      language: parsed.language || transcription.language,
      parsed: {
        ...parsed,
        categoryId: matchedCategory?.id,
        categoryName: matchedCategory?.name || parsed.categoryName,
        categoryIcon: matchedCategory?.icon || "\u{1F4E6}"
      },
      rawTranscription: transcription.text
    };
  }),
  uploadAudio: protectedProcedure.input(
    z2.object({
      audioBase64: z2.string(),
      mimeType: z2.string().default("audio/webm")
    })
  ).mutation(async ({ ctx, input }) => {
    const buffer = Buffer.from(input.audioBase64, "base64");
    const sizeMB = buffer.length / (1024 * 1024);
    if (sizeMB > 25) {
      throw new TRPCError3({ code: "BAD_REQUEST", message: "Audio file too large (max 25MB)" });
    }
    const audioId = nanoid();
    return { audioId, size: buffer.length };
  })
});
var reportsRouter = router({
  summary: protectedProcedure.input(
    z2.object({
      startDate: z2.number().optional(),
      endDate: z2.number().optional(),
      familyGroupId: z2.number().optional()
    }).optional()
  ).query(async ({ ctx, input }) => {
    if (input?.familyGroupId) {
      const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
      if (!isMember) throw new TRPCError3({ code: "FORBIDDEN" });
    }
    return getReportSummary(ctx.user.id, input ?? void 0);
  }),
  byCategory: protectedProcedure.input(
    z2.object({
      startDate: z2.number().optional(),
      endDate: z2.number().optional(),
      familyGroupId: z2.number().optional(),
      type: z2.enum(["income", "expense"]).optional()
    }).optional()
  ).query(async ({ ctx, input }) => {
    if (input?.familyGroupId) {
      const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
      if (!isMember) throw new TRPCError3({ code: "FORBIDDEN" });
    }
    return getReportByCategory(ctx.user.id, input ?? void 0);
  }),
  exportCsv: protectedProcedure.input(
    z2.object({
      startDate: z2.number().optional(),
      endDate: z2.number().optional(),
      familyGroupId: z2.number().optional()
    }).optional()
  ).mutation(async ({ ctx, input }) => {
    if (input?.familyGroupId) {
      const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
      if (!isMember) throw new TRPCError3({ code: "FORBIDDEN" });
    }
    const txns = await getTransactions(ctx.user.id, {
      ...input,
      limit: 5e3
    });
    const header = "Date,Type,Category,Amount,Currency,Description,Family\n";
    const rows = txns.map((t2) => {
      const date = new Date(t2.transaction.date).toISOString().split("T")[0];
      const desc2 = (t2.transaction.description || "").replace(/"/g, '""');
      return `${date},${t2.transaction.type},${t2.categoryName || ""},${t2.transaction.amount},${t2.transaction.currency},"${desc2}",${t2.transaction.isFamily ? "Yes" : "No"}`;
    }).join("\n");
    const csv = header + rows;
    return {
      csv,
      filename: `transactions_${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.csv`
    };
  })
});
var familyRouter = router({
  myGroups: protectedProcedure.query(async ({ ctx }) => {
    return getFamilyGroupsByUserId(ctx.user.id);
  }),
  create: protectedProcedure.input(z2.object({ name: z2.string().min(1).max(128) })).mutation(async ({ ctx, input }) => {
    const existingGroups = await getFamilyGroupsByUserId(ctx.user.id);
    if (existingGroups.length > 0) {
      throw new TRPCError3({
        code: "BAD_REQUEST",
        message: "\u0412\u044B \u0443\u0436\u0435 \u0441\u043E\u0441\u0442\u043E\u0438\u0442\u0435 \u0432 \u0441\u0435\u043C\u0435\u0439\u043D\u043E\u0439 \u0433\u0440\u0443\u043F\u043F\u0435. \u041F\u043E\u043A\u0438\u043D\u044C\u0442\u0435 \u0435\u0451 \u043F\u0435\u0440\u0435\u0434 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0435\u043C \u043D\u043E\u0432\u043E\u0439."
      });
    }
    const inviteCode = nanoid(8).toUpperCase();
    const result = await createFamilyGroup({
      name: input.name,
      inviteCode,
      ownerId: ctx.user.id
    });
    if (result) {
      await joinFamilyGroup(result.id, ctx.user.id);
    }
    return result;
  }),
  join: protectedProcedure.input(z2.object({ inviteCode: z2.string().min(1) })).mutation(async ({ ctx, input }) => {
    const group = await getFamilyGroupByInviteCode(input.inviteCode.toUpperCase());
    if (!group) throw new TRPCError3({ code: "NOT_FOUND", message: "Invalid invite code" });
    await joinFamilyGroup(group.id, ctx.user.id);
    return group;
  }),
  leave: protectedProcedure.input(z2.object({ familyGroupId: z2.number() })).mutation(async ({ ctx, input }) => {
    await leaveFamilyGroup(input.familyGroupId, ctx.user.id);
    return { success: true };
  }),
  members: protectedProcedure.input(z2.object({ familyGroupId: z2.number() })).query(async ({ ctx, input }) => {
    const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
    if (!isMember) throw new TRPCError3({ code: "FORBIDDEN" });
    return getFamilyGroupMembers(input.familyGroupId);
  })
});
var settingsRouter = router({
  update: protectedProcedure.input(
    z2.object({
      preferredLanguage: z2.string().optional(),
      preferredCurrency: z2.string().optional()
    })
  ).mutation(async ({ ctx, input }) => {
    await updateUserTelegram(ctx.user.id, input);
    return { success: true };
  })
});
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  categories: categoriesRouter,
  transactions: transactionsRouter,
  voice: voiceRouter,
  reports: reportsRouter,
  family: familyRouter,
  settings: settingsRouter
});

// server/_core/context.ts
async function createContext({ req, res }) {
  let user = null;
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7).trim();
    }
    if (!token) {
      const cookieHeader = req.headers.cookie;
      if (cookieHeader) {
        const cookies = /* @__PURE__ */ new Map();
        cookieHeader.split(";").forEach((cookie) => {
          const eqIdx = cookie.indexOf("=");
          if (eqIdx > 0) {
            const name = cookie.substring(0, eqIdx).trim();
            const value = cookie.substring(eqIdx + 1).trim();
            try {
              cookies.set(name, decodeURIComponent(value));
            } catch {
              cookies.set(name, value);
            }
          }
        });
        token = cookies.get("cashual_session") ?? null;
      }
    }
    if (token) {
      const session = verifySessionToken(token);
      if (session) {
        user = await getUserById(session.userId) ?? null;
      }
    }
  } catch (error) {
    console.error("[Context] Auth error:", error);
    user = null;
  }
  return { req, res, user };
}

// server/_core/static.ts
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
function getDirname() {
  if (typeof import.meta.dirname !== "undefined") {
    return import.meta.dirname;
  }
  return path.dirname(fileURLToPath(import.meta.url));
}
function serveStatic(app) {
  const dirname = getDirname();
  const distPath = path.resolve(dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
    const altPath = path.resolve(process.cwd(), "dist", "public");
    if (fs.existsSync(altPath)) {
      console.log(`Using alternative path: ${altPath}`);
      app.use(express.static(altPath));
      app.use("*", (_req, res) => {
        res.sendFile(path.resolve(altPath, "index.html"));
      });
      return;
    }
  }
  console.log(`Serving static files from: ${distPath}`);
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerTelegramRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV !== "development") {
    serveStatic(app);
  } else {
    const viteMod = await import(
      /* @vite-ignore */
      "./vite.js"
    );
    await viteMod.setupVite(app, server);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
