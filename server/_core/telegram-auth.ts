import crypto from "crypto";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";

const COOKIE_NAME = "cashual_session";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export type SessionPayload = {
  userId: number;
  telegramId: string;
};

/**
 * Validate Telegram initData signature
 * https://core.telegram.org/bots/webapps#validating-data-received-from-the-web-app
 */
export function validateTelegramInitData(initData: string): Record<string, string> | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    
    if (!hash) {
      console.warn("[Telegram] No hash in initData");
      return null;
    }

    // Remove hash from params
    params.delete("hash");

    // Sort params and create data check string
    const dataCheckString = Array.from(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    // Create HMAC
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(ENV.telegramBotToken)
      .digest();

    const computedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (computedHash !== hash) {
      console.warn("[Telegram] Invalid hash signature");
      return null;
    }

    // Convert URLSearchParams to object
    const data: Record<string, string> = {};
    params.forEach((value, key) => {
      data[key] = value;
    });

    return data;
  } catch (error) {
    console.error("[Telegram] Failed to validate initData:", error);
    return null;
  }
}

/**
 * Parse user data from Telegram initData
 */
export function parseTelegramUser(data: Record<string, string>) {
  try {
    const userJson = data.user;
    if (!userJson) return null;

    const user = JSON.parse(userJson);
    return {
      telegramId: String(user.id),
      telegramUsername: user.username || null,
      telegramFirstName: user.first_name || null,
      telegramLastName: user.last_name || null,
      telegramPhotoUrl: user.photo_url || null,
    };
  } catch (error) {
    console.error("[Telegram] Failed to parse user data:", error);
    return null;
  }
}

/**
 * Create a session token for a Telegram user
 */
export async function createSessionToken(
  userId: number,
  telegramId: string,
  options: { expiresInMs?: number } = {}
): Promise<string> {
  const issuedAt = Date.now();
  const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
  const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
  const secretKey = new TextEncoder().encode(ENV.cookieSecret);

  return new SignJWT({
    userId,
    telegramId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .sign(secretKey);
}

/**
 * Verify and decode a session token
 */
export async function verifySessionToken(
  token: string | null | undefined
): Promise<SessionPayload | null> {
  if (!token) {
    console.warn("[Auth] Missing session token");
    return null;
  }

  try {
    const secretKey = new TextEncoder().encode(ENV.cookieSecret);
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    });

    const { userId, telegramId } = payload as Record<string, unknown>;

    if (typeof userId !== "number" || typeof telegramId !== "string") {
      console.warn("[Auth] Invalid session payload");
      return null;
    }

    return { userId, telegramId };
  } catch (error) {
    console.warn("[Auth] Session verification failed:", String(error));
    return null;
  }
}

/**
 * Authenticate a request using session cookie
 */
export async function authenticateRequest(req: Request): Promise<User | null> {
  try {
    // Parse cookies
    const cookieHeader = req.headers.cookie;
    const cookies = new Map<string, string>();
    
    if (cookieHeader) {
      cookieHeader.split(";").forEach((cookie) => {
        const [name, value] = cookie.trim().split("=");
        if (name && value) {
          cookies.set(name, decodeURIComponent(value));
        }
      });
    }

    const sessionToken = cookies.get(COOKIE_NAME);
    const session = await verifySessionToken(sessionToken);

    if (!session) {
      return null;
    }

    const user = await db.getUserById(session.userId);
    if (!user) {
      return null;
    }

    // Update last signed in timestamp
    await db.upsertUser({
      openId: user.openId,
      lastSignedIn: new Date(),
    })

    return user;
  } catch (error) {
    console.error("[Auth] Authentication failed:", error);
    return null;
  }
}

export { COOKIE_NAME, ONE_YEAR_MS };
