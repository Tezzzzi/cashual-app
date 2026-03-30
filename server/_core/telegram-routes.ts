import type { Express, Request, Response } from "express";
import { getSessionCookieOptions } from "./cookies";
import {
  validateTelegramInitData,
  parseTelegramUser,
  createSessionToken,
  COOKIE_NAME,
  ONE_YEAR_MS,
} from "./telegram-auth";
import * as db from "../db";

/**
 * Register Telegram authentication routes
 * POST /api/telegram/auth - Validate initData and create session
 */
export function registerTelegramRoutes(app: Express) {
  app.post("/api/telegram/auth", async (req: Request, res: Response) => {
    try {
      const { initData } = req.body;

      if (!initData || typeof initData !== "string") {
        return res.status(400).json({ error: "Missing or invalid initData" });
      }

      // Validate Telegram initData signature
      const data = validateTelegramInitData(initData);
      if (!data) {
        return res.status(401).json({ error: "Invalid Telegram signature" });
      }

      // Parse user data
      const telegramUser = parseTelegramUser(data);
      if (!telegramUser) {
        return res.status(400).json({ error: "Failed to parse user data" });
      }

      // Get or create user in database
      let user = await db.getUserByTelegramId(telegramUser.telegramId);

      if (!user) {
        // Create new user with unique openId based on telegramId
        const openId = `telegram_${telegramUser.telegramId}`;
        await db.upsertUser({
          openId,
          name: telegramUser.telegramFirstName || "User",
          email: null,
          loginMethod: "telegram",
          telegramId: telegramUser.telegramId,
          telegramUsername: telegramUser.telegramUsername,
          telegramFirstName: telegramUser.telegramFirstName,
          telegramLastName: telegramUser.telegramLastName,
          telegramPhotoUrl: telegramUser.telegramPhotoUrl,
          preferredLanguage: "ru",
          preferredCurrency: "AZN",
          lastSignedIn: new Date(),
        });

        user = await db.getUserByTelegramId(telegramUser.telegramId);
      } else {
        // Update existing user with latest Telegram data
        await db.updateUserTelegram(user.id, {
          telegramUsername: telegramUser.telegramUsername,
          telegramFirstName: telegramUser.telegramFirstName,
          telegramLastName: telegramUser.telegramLastName,
          telegramPhotoUrl: telegramUser.telegramPhotoUrl,
        });

        // Update lastSignedIn
        await db.upsertUser({
          openId: user.openId,
          lastSignedIn: new Date(),
        });
      }

      if (!user) {
        return res.status(500).json({ error: "Failed to create or retrieve user" });
      }

      // Create session token
      const sessionToken = await createSessionToken(user.id, telegramUser.telegramId);

      // Set session cookie
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      return res.json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          telegramId: user.telegramId,
          preferredLanguage: user.preferredLanguage,
          preferredCurrency: user.preferredCurrency,
        },
      });
    } catch (error) {
      console.error("[Telegram Auth] Error:", error);
      return res.status(500).json({ error: "Authentication failed" });
    }
  });

  // Health check endpoint
  app.get("/api/health", (req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });
}
