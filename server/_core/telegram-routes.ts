import type { Express, Request, Response } from "express";
import {
  validateTelegramInitData,
  parseTelegramUser,
  createSessionToken,
} from "./telegram-auth";
import * as db from "../db";

/**
 * Register Telegram authentication routes
 * POST /api/telegram/auth - Validate initData and create session
 *
 * NOTE: We use Bearer token in response body (not cookies) because
 * Telegram Mini App WebView has restrictions on third-party cookies.
 * The frontend stores the token in localStorage and sends it as
 * Authorization: Bearer <token> header on every request.
 */
export function registerTelegramRoutes(app: Express) {
  app.post("/api/telegram/auth", async (req: Request, res: Response) => {
    try {
      const { initData } = req.body;

      if (!initData || typeof initData !== "string") {
        console.warn("[Telegram Auth] Missing or invalid initData");
        return res.status(400).json({ error: "Missing or invalid initData" });
      }

      console.log("[Telegram Auth] Received initData length:", initData.length);
      console.log("[Telegram Auth] initData preview:", initData.substring(0, 100));

      // Validate Telegram initData signature
      const data = validateTelegramInitData(initData);
      if (!data) {
        console.warn("[Telegram Auth] Signature validation failed");
        return res.status(401).json({ error: "Invalid Telegram signature" });
      }

      // Parse user data from validated initData
      const telegramUser = parseTelegramUser(data);
      if (!telegramUser) {
        console.warn("[Telegram Auth] Failed to parse user from data:", JSON.stringify(data));
        return res.status(400).json({ error: "Failed to parse user data" });
      }

      console.log("[Telegram Auth] Parsed user:", telegramUser.telegramId, telegramUser.telegramFirstName);

      // Get or create user in database
      let user = await db.getUserByTelegramId(telegramUser.telegramId);

      if (!user) {
        console.log("[Telegram Auth] Creating new user for telegramId:", telegramUser.telegramId);

        const openId = `telegram_${telegramUser.telegramId}`;

        await db.upsertUser({
          openId,
          name: telegramUser.telegramFirstName || telegramUser.telegramUsername || "User",
          email: null,
          loginMethod: "telegram",
          telegramId: telegramUser.telegramId,
          telegramUsername: telegramUser.telegramUsername ?? undefined,
          telegramFirstName: telegramUser.telegramFirstName ?? undefined,
          telegramLastName: telegramUser.telegramLastName ?? undefined,
          telegramPhotoUrl: telegramUser.telegramPhotoUrl ?? undefined,
          preferredLanguage: "ru",
          preferredCurrency: "AZN",
          lastSignedIn: new Date(),
        });

        // Fetch the newly created user by telegramId
        user = await db.getUserByTelegramId(telegramUser.telegramId);

        if (!user) {
          // Fallback: try by openId
          user = await db.getUserByOpenId(openId);
        }
      } else {
        console.log("[Telegram Auth] Found existing user id:", user.id);

        // Update existing user with latest Telegram data
        await db.updateUserTelegram(user.id, {
          telegramUsername: telegramUser.telegramUsername ?? undefined,
          telegramFirstName: telegramUser.telegramFirstName ?? undefined,
          telegramLastName: telegramUser.telegramLastName ?? undefined,
          telegramPhotoUrl: telegramUser.telegramPhotoUrl ?? undefined,
        });
      }

      if (!user) {
        console.error("[Telegram Auth] Failed to create or retrieve user for telegramId:", telegramUser.telegramId);
        return res.status(500).json({ error: "Failed to create or retrieve user" });
      }

      // Create JWT session token
      const sessionToken = createSessionToken(user.id, telegramUser.telegramId);

      console.log("[Telegram Auth] Success for user id:", user.id);

      // Return token in response body - frontend stores in localStorage
      // This avoids cookie issues in Telegram Mini App WebView
      return res.json({
        success: true,
        token: sessionToken,
        user: {
          id: user.id,
          name: user.name,
          telegramId: user.telegramId,
          preferredLanguage: user.preferredLanguage,
          preferredCurrency: user.preferredCurrency,
        },
      });
    } catch (error) {
      console.error("[Telegram Auth] Unhandled error:", error);
      return res.status(500).json({ error: "Authentication failed", details: String(error) });
    }
  });

  // Health check endpoint
  app.get("/api/health", (req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });
}
