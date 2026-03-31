import type { inferAsyncReturnType } from "@trpc/server";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { verifySessionToken } from "./telegram-auth";
import * as db from "../db";
import type { User } from "../../drizzle/schema";

/**
 * Build tRPC context for each request.
 *
 * Auth strategy: Bearer token in Authorization header (stored in localStorage on frontend).
 * This avoids cookie issues in Telegram Mini App WebView environment.
 * Fallback: also reads from cashual_session cookie for browser-based access.
 */
export async function createContext({ req, res }: CreateExpressContextOptions) {
  let user: User | null = null;

  try {
    let token: string | null = null;

    // Primary: Authorization: Bearer <token> header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7).trim();
    }

    // Fallback: cashual_session cookie
    if (!token) {
      const cookieHeader = req.headers.cookie;
      if (cookieHeader) {
        const cookies = new Map<string, string>();
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
        user = (await db.getUserById(session.userId)) ?? null;
      }
    }
  } catch (error) {
    console.error("[Context] Auth error:", error);
    user = null;
  }

  return { req, res, user };
}

export type TrpcContext = inferAsyncReturnType<typeof createContext>;
