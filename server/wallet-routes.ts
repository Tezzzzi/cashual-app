import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { eq } from "drizzle-orm";
import { users, transactions, categories } from "../drizzle/schema";
import {
  getDb,
  getCategories,
  createTransaction,
  findLearnedCategory,
  upsertCategoryRule,
} from "./db";
import { invokeLLM } from "./_core/openai-llm";
import { ENV } from "./_core/env";

// ─── Rate Limiter ────────────────────────────────────────────────────────────
const walletLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse amount from various formats:
 * "3.30", "3,30", "3,30 €", "3.30 EUR", "€3.30", "EUR 3.30", "1 234,56"
 */
function parseAmountString(raw: string | undefined): number {
  if (!raw) return NaN;
  // Remove currency symbols and codes
  let cleaned = raw.replace(/[€$£¥₽₺₴\s]/g, "").replace(/[A-Za-z]{3}/g, "").trim();
  // If empty after cleaning, try original with just whitespace removed
  if (!cleaned) cleaned = raw.replace(/\s/g, "");
  // Handle European format: 1.234,56 or 3,30
  // If there's a comma and no dot after it, treat comma as decimal separator
  if (cleaned.includes(",")) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      // Comma is the decimal separator: remove dots (thousands), replace comma with dot
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    }
    // else dot is decimal separator, just remove commas (thousands)
    else {
      cleaned = cleaned.replace(/,/g, "");
    }
  }
  // Remove any remaining non-numeric chars except dot and minus
  cleaned = cleaned.replace(/[^0-9.\-]/g, "");
  return parseFloat(cleaned);
}

async function getUserByWalletToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.walletToken, token))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

async function sendTelegramNotification(chatId: string, text: string) {
  if (!ENV.telegramBotToken || !chatId) return;
  try {
    await fetch(
      `https://api.telegram.org/bot${ENV.telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
      }
    );
  } catch (err) {
    console.error("[Wallet] Failed to send Telegram notification:", err);
  }
}

// Category name aliases (same as routers.ts)
const CATEGORY_NAME_ALIASES: Record<string, string> = {
  food: "Food",
  grocery: "Food",
  groceries: "Food",
  transport: "Transport",
  transportation: "Transport",
  housing: "Housing",
  rent: "Housing",
  entertainment: "Entertainment",
  health: "Health",
  healthcare: "Health",
  clothing: "Clothing",
  clothes: "Clothing",
  education: "Education",
  restaurants: "Restaurants",
  restaurant: "Restaurants",
  dining: "Restaurants",
  communication: "Communication",
  phone: "Communication",
  internet: "Communication",
  subscriptions: "Subscriptions",
  subscription: "Subscriptions",
  gifts: "Gifts",
  gift: "Gifts",
  salary: "Salary",
  freelance: "Freelance",
  investments: "Investments",
  investment: "Investments",
  other: "Other",
  pets: "Pets",
  beauty: "Beauty",
  sports: "Sports",
  sport: "Sports",
  charity: "Charity",
  auto: "Auto",
  car: "Auto",
  electronics: "Electronics",
  tech: "Electronics",
};

function normalizeCategoryNameToEnglish(name: string) {
  const trimmed = name.trim();
  return CATEGORY_NAME_ALIASES[trimmed.toLowerCase()] || trimmed;
}

function findCategoryByCanonicalName<T extends { name: string }>(
  userCategories: T[],
  categoryName: string
) {
  const canonicalName = normalizeCategoryNameToEnglish(categoryName);
  const canonicalKey = canonicalName.toLowerCase();
  return (
    userCategories.find(
      (c) =>
        normalizeCategoryNameToEnglish(c.name).toLowerCase() === canonicalKey
    ) ||
    userCategories.find((c) => {
      const existingKey = normalizeCategoryNameToEnglish(c.name).toLowerCase();
      return existingKey.includes(canonicalKey) || canonicalKey.includes(existingKey);
    })
  );
}

async function categorizeTransaction(
  userId: number,
  merchant: string,
  userCategories: Array<{ id: number; name: string; icon: string }>
): Promise<{ categoryId: number; categoryName: string }> {
  // 1. Try learned category
  const learnedCategoryId = await findLearnedCategory(userId, merchant);
  if (learnedCategoryId) {
    const cat = userCategories.find((c) => c.id === learnedCategoryId);
    if (cat) return { categoryId: cat.id, categoryName: cat.name };
  }

  // 2. Try direct alias match
  const directMatch = findCategoryByCanonicalName(userCategories, merchant);
  if (directMatch) {
    return { categoryId: (directMatch as any).id, categoryName: directMatch.name };
  }

  // 3. LLM fallback
  try {
    const categoryNames = userCategories.map((c) => c.name).join(", ");
    const llmResult = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a transaction categorizer. Given a merchant/description, pick the best matching category from the list. Return ONLY the category name, nothing else. If nothing fits well, return "Other".\n\nAvailable categories: ${categoryNames}`,
        },
        {
          role: "user",
          content: `Categorize this transaction: "${merchant}"`,
        },
      ],
      max_tokens: 50,
    });

    const suggestedName =
      llmResult.choices[0]?.message?.content?.trim() || "Other";
    const llmMatch = findCategoryByCanonicalName(userCategories, suggestedName);
    if (llmMatch) {
      return { categoryId: (llmMatch as any).id, categoryName: llmMatch.name };
    }
  } catch (err) {
    console.error("[Wallet] LLM categorization failed:", err);
  }

  // 4. Fallback to "Other" or last category
  const otherCat = findCategoryByCanonicalName(userCategories, "Other");
  if (otherCat) {
    return { categoryId: (otherCat as any).id, categoryName: otherCat.name };
  }
  const fallback = userCategories[userCategories.length - 1];
  return { categoryId: fallback.id, categoryName: fallback.name };
}

// ─── Register Routes ─────────────────────────────────────────────────────────

export function registerWalletRoutes(app: Express) {
  // ─── Simple GET endpoint (for iOS Shortcuts - just paste URL) ───────────────
  app.get(
    "/api/wallet/transaction",
    walletLimiter,
    async (req: Request, res: Response) => {
      try {
        // All params come from URL query string
        const { token, amount, merchant, currency, date, card } = req.query as Record<string, string>;

        if (!token || token.length < 10) {
          return res.status(401).json({ error: "Invalid token" });
        }

        console.log("[Wallet] GET request params:", { token: token?.slice(0, 8) + "...", amount, merchant, currency, date, card });

        const numAmount = parseAmountString(amount);
        if (!amount || isNaN(numAmount) || numAmount <= 0) {
          console.error("[Wallet] Invalid amount:", JSON.stringify(amount), "parsed as:", numAmount);
          return res.status(400).json({ error: "Invalid amount", received: amount, parsed: numAmount });
        }
        if (!merchant) {
          return res.status(400).json({ error: "Invalid merchant" });
        }

        // Authenticate user by token
        const user = await getUserByWalletToken(token);
        if (!user) {
          return res.status(401).json({ error: "Invalid token" });
        }

        // Get user categories
        const userCategories = await getCategories(user.id);
        if (!userCategories || userCategories.length === 0) {
          return res.status(500).json({ error: "No categories available" });
        }

        // Auto-categorize
        const { categoryId, categoryName } = await categorizeTransaction(
          user.id,
          merchant,
          userCategories
        );

        // Determine date and currency
        const txDate = date ? new Date(date).getTime() : Date.now();
        const txCurrency = (currency || user.preferredCurrency || "EUR").toUpperCase();
        const description = card ? `${merchant} (${card})` : merchant;

        // Save transaction
        const result = await createTransaction({
          userId: user.id,
          categoryId,
          type: "expense",
          amount: numAmount.toFixed(2),
          currency: txCurrency,
          description,
          date: txDate,
          isFamily: false,
          familyGroupId: null,
          isWork: false,
          businessGroupId: null,
          originalAmount: null,
          originalCurrency: null,
          exchangeRate: null,
          sourceLanguage: null,
          rawTranscription: null,
        });

        // Learn category rule
        await upsertCategoryRule(user.id, merchant, categoryId);

        // Send Telegram notification
        if (user.telegramId) {
          const notificationText = `✅ Записано: ${merchant} ${numAmount}${txCurrency} → ${categoryName}`;
          await sendTelegramNotification(user.telegramId, notificationText);
        }

        return res.status(200).json({
          success: true,
          transactionId: result?.id ?? null,
          category: categoryName,
        });
      } catch (err) {
        console.error("[Wallet] GET webhook error:", err);
        return res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // ─── POST endpoint (legacy, with Authorization header) ─────────────────────
  app.post(
    "/api/wallet/transaction",
    walletLimiter,
    async (req: Request, res: Response) => {
      try {
        // Support token from query string OR Authorization header
        let token = (req.query.token as string) || "";
        if (!token) {
          const authHeader = req.headers.authorization;
          if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Missing or invalid authorization token" });
          }
          token = authHeader.slice(7).trim();
        }
        if (!token || token.length < 10) {
          return res.status(401).json({ error: "Invalid token format" });
        }

        // Validate request body
        const { amount, merchant, currency, date, cardName } = req.body;
        if (!amount || typeof amount !== "number" || amount <= 0) {
          return res.status(400).json({ error: "Invalid amount: must be a positive number" });
        }
        if (!merchant || typeof merchant !== "string") {
          return res.status(400).json({ error: "Invalid merchant: must be a non-empty string" });
        }
        if (!currency || typeof currency !== "string") {
          return res.status(400).json({ error: "Invalid currency: must be a non-empty string" });
        }

        // Authenticate user by token
        const user = await getUserByWalletToken(token);
        if (!user) {
          return res.status(401).json({ error: "Invalid token" });
        }

        // Get user categories
        const userCategories = await getCategories(user.id);
        if (!userCategories || userCategories.length === 0) {
          return res.status(500).json({ error: "No categories available for user" });
        }

        // Auto-categorize
        const { categoryId, categoryName } = await categorizeTransaction(
          user.id,
          merchant,
          userCategories
        );

        // Determine date (use provided or now)
        const txDate = date ? new Date(date).getTime() : Date.now();

        // Build description
        const description = cardName
          ? `${merchant} (${cardName})`
          : merchant;

        // Save transaction
        const result = await createTransaction({
          userId: user.id,
          categoryId,
          type: "expense",
          amount: amount.toFixed(2),
          currency: currency.toUpperCase(),
          description,
          date: txDate,
          isFamily: false,
          familyGroupId: null,
          isWork: false,
          businessGroupId: null,
          originalAmount: null,
          originalCurrency: null,
          exchangeRate: null,
          sourceLanguage: null,
          rawTranscription: null,
        });

        // Learn category rule
        await upsertCategoryRule(user.id, merchant, categoryId);

        // Send Telegram notification
        if (user.telegramId) {
          const notificationText = `✅ Записано: ${merchant} ${amount}${currency.toUpperCase()} → ${categoryName}`;
          await sendTelegramNotification(user.telegramId, notificationText);
        }

        return res.status(200).json({
          success: true,
          transactionId: result?.id ?? null,
          category: categoryName,
        });
      } catch (err) {
        console.error("[Wallet] Webhook error:", err);
        return res.status(500).json({ error: "Internal server error" });
      }
    }
  );
}
