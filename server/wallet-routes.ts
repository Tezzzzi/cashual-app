import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { eq } from "drizzle-orm";
import { users, transactions, categories } from "../drizzle/schema";
import {
  getDb,
  getCategories,
  createCategory,
  createTransaction,
  findLearnedCategory,
  upsertCategoryRule,
  getUserCategoryRules,
  getBusinessGroups,
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
  // ─── Siri Shortcuts Voice endpoint ────────────────────────────────────────────
  // Support both GET and POST for /api/wallet/voice
  const voiceHandler = async (req: Request, res: Response) => {
      try {
        console.log("[Wallet/Voice] Method:", req.method);
        console.log("[Wallet/Voice] Full URL:", req.originalUrl);
        console.log("[Wallet/Voice] Body:", JSON.stringify(req.body));

        // Get token from query string or body
        const token = (req.query.token as string) || req.body?.token;

        // Get text from body (POST) or query string (GET)
        let rawText = req.body?.text || (req.query.text as string);

        // Fallback for GET: if text is missing or too short, try to extract from raw URL
        if ((!rawText || rawText.trim().length < 2) && req.method === 'GET') {
          const fullUrl = req.originalUrl || req.url;
          const textMatch = fullUrl.match(/[&?]text=(.+?)(?:&|$)/);
          if (textMatch) {
            rawText = decodeURIComponent(textMatch[1].replace(/\+/g, ' '));
          }
        }

        // Another GET fallback: grab everything after &text= till end of URL
        if ((!rawText || rawText.trim().length < 2) && req.method === 'GET') {
          const fullUrl = req.originalUrl || req.url;
          const textIdx = fullUrl.indexOf('text=');
          if (textIdx !== -1) {
            const afterText = fullUrl.substring(textIdx + 5);
            rawText = decodeURIComponent(afterText.replace(/\+/g, ' '));
          }
        }

        if (!token || token.length < 10) {
          return res.status(401).json({ error: "Invalid token" });
        }
        if (!rawText || rawText.trim().length === 0) {
          return res.status(400).json({ error: "Missing text parameter" });
        }

        // Decode and trim the text
        const text = (req.method === 'GET' ? decodeURIComponent(rawText) : rawText).trim();
        console.log("[Wallet/Voice] Text:", text);

        // Authenticate user by wallet token
        const user = await getUserByWalletToken(token);
        if (!user) {
          return res.status(401).json({ error: "Invalid token" });
        }

        // Get user categories
        const userCategories = await getCategories(user.id);
        if (!userCategories || userCategories.length === 0) {
          return res.status(500).json({ error: "No categories available" });
        }

        // Build category names list for LLM prompt
        const categoryNames = Array.from(
          new Set(userCategories.map((c) => normalizeCategoryNameToEnglish(c.name)).filter(Boolean))
        ).map((name) => `"${name}"`).join(", ");

        // Get user's learned category rules
        const learnedRules = await getUserCategoryRules(user.id);
        const userRulesPrompt = learnedRules.length > 0
          ? learnedRules
              .map((rule) => {
                const category = userCategories.find((c) => c.id === rule.categoryId);
                return category ? `"${rule.pattern}" → ${normalizeCategoryNameToEnglish(category.name)} (${rule.hitCount})` : null;
              })
              .filter(Boolean)
              .join(", ")
          : "(none)";

        // Get business groups for work context
        const userBusinessGroups = await getBusinessGroups(user.id);
        const businessGroupNames = userBusinessGroups.length > 0
          ? userBusinessGroups.map((g: any, i: number) => `${i + 1}. "${g.name}"`).join(", ")
          : "(none)";

        const now = new Date();
        const currentYear = now.getFullYear();
        const todayMs = now.getTime();
        const preferredCurrency = user.preferredCurrency || "EUR";

        // Parse with LLM (same prompt as voice.transcribeAndParse)
        const llmResult = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are a financial transaction parser. Extract structured data from the user's text input.

**CRITICAL: The user may dictate MULTIPLE transactions in a single message.** Each distinct expense/income mentioned should be a separate transaction in the array.

Available categories (canonical English names): ${categoryNames}

User's learned category preferences (description → category, usage count):
${userRulesPrompt}
These take priority over general rules when the description matches.

CATEGORY LANGUAGE RULES:
- ALWAYS return categoryName in English, regardless of the input language.
- Match semantically across languages. For example, Russian "авто" must match "Auto", "еда" must match "Food".
- If none of the available categories fits well, create a new short descriptive category name in English and set newCategoryEmoji.
- Never return Russian, Azerbaijani, or mixed-language category names.

**IMPORTANT — TODAY'S DATE: ${now.toISOString()} (year ${currentYear})**
The current Unix timestamp in milliseconds is: ${todayMs}
You MUST use the year ${currentYear} for all dates.

User's preferred currency: ${preferredCurrency}

Rules for EACH transaction:
- Determine if it's income or expense from context
- Match semantically to the closest available category name and return that categoryName in English
- Extract the amount (number only)
- Determine the currency from context clues:
  * "манат" / "manat" / "AZN" → AZN
  * "доллар" / "dollar" / "бакс" / "USD" → USD
  * "евро" / "euro" / "EUR" → EUR
  * "рубль" / "рублей" / "руб" / "RUB" → RUB
  * "лира" / "TRY" → TRY
  * "фунт" / "pound" / "GBP" → GBP
  * "лари" / "GEL" → GEL
  * "франк" / "CHF" → CHF
  * If no currency mentioned, default to: ${preferredCurrency}
- Create a short description
- If no specific date mentioned, use today's timestamp: ${todayMs}
- The date field MUST be a Unix timestamp in milliseconds in the year ${currentYear}
- Detect the language of the text (ru, az, en)

BUDGET CONTEXT DETECTION:
User's default budget: ${(user as any).defaultBudget || "personal"}
User's business workspaces: ${businessGroupNames}
- WORK triggers: "рабочий", "рабочие", "для работы", "для компании", "компания", "бизнес", "клиент", "проект", "офис", "iş", "iş xərci", "şirkət", "biznes", "work", "business", "company", "client", "project", "office", "corporate".
- FAMILY triggers: "семейный", "семья", "для семьи", "ailə", "ailə xərci", "family", "для жены", "для мужа", "для детей", "домой"
- DEFAULT: If no work or family trigger → set budgetContext to "${(user as any).defaultBudget || "personal"}"

CATEGORY MATCHING RULES:
- Hotel minibar, hotel bar, hotel restaurant, room service → "Restaurants"
- Any food or drink purchase (cafe, coffee, restaurant, bar) → "Restaurants"
- Hotel room/accommodation/rent/apartment → "Housing"
- Taxi, uber, bus, metro, train, flight → "Transport"
- Cinema, concert, club, entertainment → "Entertainment"
- Grocery store, supermarket, food market → "Food"
- Pharmacy, doctor, clinic, medicine → "Health"
- Clothing store, shoes, fashion → "Clothing"
- Internet, phone plan, mobile top-up → "Communication"
- Netflix, Spotify, app subscription → "Subscriptions"
- Gift, present → "Gifts"
- Salary, wage → "Salary"
- Freelance work payment → "Freelance"
- Stock, crypto, investment → "Investments"
- Vet, pet care, pet food → "Pets" with emoji 🐾
- Beauty salon, haircut, spa → "Beauty" with emoji 💅
- Sports, gym, fitness → "Sports" with emoji 🏋️
- Education, course, books → "Education" with emoji 📚
- Charity, donation → "Charity" with emoji 🤝
- Electronics, computer, gadgets → "Electronics" with emoji 💻
- Car repair, car wash, parking, fuel → "Auto" with emoji 🚗

NEW CATEGORY RULE: If the transaction does NOT match any existing category well, set categoryName to a NEW descriptive English name and set newCategoryEmoji to a single appropriate emoji.
If the transaction DOES match an existing category, set newCategoryEmoji to empty string "".

Always return a transactions array, even for a single transaction.`,
            },
            {
              role: "user",
              content: `Parse ALL transactions from this text: "${text}"`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "parsed_transactions",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  language: { type: "string", description: "Detected language code (ru, az, en)" },
                  transactions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string", enum: ["income", "expense"], description: "Transaction type" },
                        amount: { type: "number", description: "Transaction amount" },
                        currency: { type: "string", description: "Currency code" },
                        categoryName: { type: "string", description: "English category name" },
                        newCategoryEmoji: { type: "string", description: "Emoji for new category, or empty string" },
                        description: { type: "string", description: "Short description" },
                        date: { type: "number", description: "Unix timestamp in milliseconds" },
                        budgetContext: { type: "string", enum: ["personal", "family", "work"], description: "Budget context" },
                        businessGroupName: { type: "string", description: "Company name if work, else empty string" },
                      },
                      required: ["type", "amount", "currency", "categoryName", "newCategoryEmoji", "description", "date", "budgetContext", "businessGroupName"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["language", "transactions"],
                additionalProperties: false,
              },
            },
          },
        });

        const content = llmResult.choices[0]?.message?.content;
        if (!content || typeof content !== "string") {
          return res.status(500).json({ error: "Failed to parse transaction from text" });
        }

        const parsed = JSON.parse(content) as {
          language: string;
          transactions: Array<{
            type: "income" | "expense";
            amount: number;
            currency: string;
            categoryName: string;
            newCategoryEmoji: string;
            description: string;
            date: number;
            budgetContext: "personal" | "family" | "work";
            businessGroupName: string;
          }>;
        };

        if (!parsed.transactions || parsed.transactions.length === 0) {
          return res.status(400).json({ error: "Could not parse any transaction from text" });
        }

        // Process and save each transaction
        const savedTransactions: Array<{
          id: number | null;
          type: string;
          amount: string;
          currency: string;
          category: string;
          description: string;
        }> = [];

        for (const tx of parsed.transactions) {
          // Resolve category
          let cat = findCategoryByCanonicalName(userCategories, tx.categoryName);

          // Check learned rules
          const learnedCategoryId = await findLearnedCategory(user.id, tx.description);
          if (learnedCategoryId) {
            const learnedCat = userCategories.find((c) => c.id === learnedCategoryId);
            if (learnedCat) cat = learnedCat;
          }

          // Auto-create new category if needed
          if (!cat && tx.newCategoryEmoji) {
            const canonicalName = normalizeCategoryNameToEnglish(tx.categoryName);
            console.log(`[Wallet/Voice] Auto-creating category: "${canonicalName}" ${tx.newCategoryEmoji}`);
            const newCat = await createCategory({
              name: canonicalName,
              icon: tx.newCategoryEmoji || "📦",
              color: "#6366f1",
              type: "both",
              isPreset: false,
              userId: user.id,
            });
            if (newCat) {
              cat = { ...newCat, name: canonicalName, icon: tx.newCategoryEmoji || "📦" } as any;
            }
          }

          // Fallback to "Other" or last category
          if (!cat) {
            cat = findCategoryByCanonicalName(userCategories, "Other") || userCategories[userCategories.length - 1];
          }

          const categoryId = (cat as any).id;
          const categoryName = (cat as any).name;

          // Date validation
          let fixedDate = tx.date;
          if (fixedDate) {
            const txDate = new Date(fixedDate);
            const txYear = txDate.getFullYear();
            if (txYear !== currentYear && txYear >= 2020 && txYear < currentYear) {
              txDate.setFullYear(currentYear);
              fixedDate = txDate.getTime();
            }
            if (fixedDate > todayMs + 86400000) {
              fixedDate = todayMs;
            }
          } else {
            fixedDate = todayMs;
          }

          // Determine budget flags — default to family for wallet transactions
          const isFamily = tx.budgetContext === "family" || tx.budgetContext === "personal";
          const isWork = tx.budgetContext === "work";
          let businessGroupId: number | null = null;
          if (isWork && tx.businessGroupName) {
            const lower = tx.businessGroupName.toLowerCase();
            const bg = userBusinessGroups.find((g: any) =>
              g.name.toLowerCase() === lower ||
              g.name.toLowerCase().includes(lower) ||
              lower.includes(g.name.toLowerCase())
            );
            if (bg) businessGroupId = (bg as any).id;
          }

          // Save transaction
          const result = await createTransaction({
            userId: user.id,
            categoryId,
            type: tx.type,
            amount: tx.amount.toFixed(2),
            currency: tx.currency.toUpperCase(),
            description: tx.description,
            date: fixedDate,
            isFamily,
            familyGroupId: null,
            isWork,
            businessGroupId,
            originalAmount: null,
            originalCurrency: null,
            exchangeRate: null,
            sourceLanguage: parsed.language || null,
            rawTranscription: text,
          });

          // Learn category rule
          await upsertCategoryRule(user.id, tx.description, categoryId);

          savedTransactions.push({
            id: result?.id ?? null,
            type: tx.type,
            amount: tx.amount.toFixed(2),
            currency: tx.currency.toUpperCase(),
            category: categoryName,
            description: tx.description,
          });
        }

        // Send Telegram notification
        if (user.telegramId) {
          const lines = savedTransactions.map((t) =>
            `${t.type === "income" ? "📥" : "📤"} ${t.description} ${t.amount} ${t.currency} → ${t.category}`
          );
          const notificationText = `🎙 Siri: ${text}\n\n${lines.join("\n")}`;
          await sendTelegramNotification(user.telegramId, notificationText);
        }

        return res.status(200).json({
          success: true,
          text,
          language: parsed.language,
          transactions: savedTransactions,
        });
      } catch (err) {
        console.error("[Wallet/Voice] Error:", err);
        return res.status(500).json({ error: "Internal server error" });
      }
  };

  app.get("/api/wallet/voice", walletLimiter, voiceHandler);
  app.post("/api/wallet/voice", walletLimiter, voiceHandler);

  // ─── Simple GET endpoint (for iOS Shortcuts - just paste URL) ───────────────
  app.get(
    "/api/wallet/transaction",
    walletLimiter,
    async (req: Request, res: Response) => {
      try {
        // Log the full raw URL for debugging
        console.log("[Wallet] Full URL:", req.originalUrl);
        console.log("[Wallet] Raw query string:", req.url.split("?")[1]);

        // All params come from URL query string
        const { token, amount, merchant, currency, date, card } = req.query as Record<string, string>;

        if (!token || token.length < 10) {
          return res.status(401).json({ error: "Invalid token" });
        }

        console.log("[Wallet] Parsed params:", { token: token?.slice(0, 8) + "...", amount, merchant, currency, date, card });

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

        // Save transaction (default to family)
        const result = await createTransaction({
          userId: user.id,
          categoryId,
          type: "expense",
          amount: numAmount.toFixed(2),
          currency: txCurrency,
          description,
          date: txDate,
          isFamily: true,
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

        // Save transaction (default to family)
        const result = await createTransaction({
          userId: user.id,
          categoryId,
          type: "expense",
          amount: amount.toFixed(2),
          currency: currency.toUpperCase(),
          description,
          date: txDate,
          isFamily: true,
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
