import crypto from "crypto";
import jwt from "jsonwebtoken";
import type { Request } from "express";
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

    // Remove hash from params before building check string
    params.delete("hash");

    // Sort params and create data check string
    const dataCheckString = Array.from(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    // Create HMAC-SHA256 secret key from "WebAppData" + bot token
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(ENV.telegramBotToken)
      .digest();

    const computedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (computedHash !== hash) {
      console.warn("[Telegram] Invalid hash. Expected:", computedHash, "Got:", hash);
      return null;
    }

    // Convert URLSearchParams to plain object
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
 * Parse user data from validated Telegram initData
 */
export function parseTelegramUser(data: Record<string, string>) {
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
      telegramPhotoUrl: user.photo_url || null,
    };
  } catch (error) {
    console.error("[Telegram] Failed to parse user data:", error);
    return null;
  }
}

/**
 * Create a session token using jsonwebtoken (Node.js native crypto, no Web Crypto needed)
 */
export function createSessionToken(
  userId: number,
  telegramId: string,
  options: { expiresInMs?: number } = {}
): string {
  const expiresInSeconds = Math.floor((options.expiresInMs ?? ONE_YEAR_MS) / 1000);
  const secret = ENV.cookieSecret;

  return jwt.sign(
    { userId, telegramId } satisfies SessionPayload,
    secret,
    { expiresIn: expiresInSeconds, algorithm: "HS256" }
  );
}

/**
 * Verify and decode a session token
 */
export function verifySessionToken(token: string | null | undefined): SessionPayload | null {
  if (!token) {
    return null;
  }

  try {
    const secret = ENV.cookieSecret;
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] }) as Record<string, unknown>;

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

/**
 * Authenticate a request using session cookie
 */
export async function authenticateRequest(req: Request): Promise<User | null> {
  try {
    // Parse cookies manually
    const cookieHeader = req.headers.cookie;
    const cookies = new Map<string, string>();

    if (cookieHeader) {
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
    }

    const sessionToken = cookies.get(COOKIE_NAME);
    const session = verifySessionToken(sessionToken);

    if (!session) {
      return null;
    }

    const user = await db.getUserById(session.userId);
    if (!user) {
      return null;
    }

    return user;
  } catch (error) {
    console.error("[Auth] Authentication failed:", error);
    return null;
  }
}

export { COOKIE_NAME, ONE_YEAR_MS };
