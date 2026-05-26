import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import {
  getCategories,
  createCategory,
  deleteCategory,
  seedPresetCategories,
  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  getReportSummary,
  getReportByCategory,
  createFamilyGroup,
  getFamilyGroupByInviteCode,
  getFamilyGroupsByUserId,
  joinFamilyGroup,
  leaveFamilyGroup,
  getFamilyGroupMembers,
  isGroupMember,
  updateUserTelegram,
  getFamilyPermissions,
  getMyPermissions,
  setFamilyPermission,
  getViewableUserIds,
  initializePermissionsForNewMember,
  getBusinessGroups,
  createBusinessGroup,
  updateBusinessGroup,
  deleteBusinessGroup,
  getDb,
} from "./db";
import { transactions, categories } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { transcribeAudio } from "./_core/openai-whisper";
import { invokeLLM } from "./_core/openai-llm";
import { convertCurrency } from "./exchange-rates";
import { ENV } from "./_core/env";

// ─── Category Canonicalization ─────────────────────────────────────────
// Categories are stored canonically in English. UI translates them for display.
const CATEGORY_NAME_ALIASES: Record<string, string> = {
  "food": "Food",
  "foods": "Food",
  "grocery": "Food",
  "groceries": "Food",
  "продукты": "Food",
  "еда": "Food",
  "питание": "Food",
  "ərzaq": "Food",
  "yemək": "Food",
  "transport": "Transport",
  "transportation": "Transport",
  "транспорт": "Transport",
  "такси": "Transport",
  "nəqliyyat": "Transport",
  "housing": "Housing",
  "rent": "Housing",
  "accommodation": "Housing",
  "жильё": "Housing",
  "жилье": "Housing",
  "аренда": "Housing",
  "mənzil": "Housing",
  "entertainment": "Entertainment",
  "развлечения": "Entertainment",
  "əyləncə": "Entertainment",
  "health": "Health",
  "healthcare": "Health",
  "здоровье": "Health",
  "sağlamlıq": "Health",
  "clothing": "Clothing",
  "clothes": "Clothing",
  "одежда": "Clothing",
  "geyim": "Clothing",
  "education": "Education",
  "образование": "Education",
  "təhsil": "Education",
  "restaurants": "Restaurants",
  "restaurant": "Restaurants",
  "dining": "Restaurants",
  "кафе": "Restaurants",
  "рестораны": "Restaurants",
  "ресторан": "Restaurants",
  "restoranlar": "Restaurants",
  "communication": "Communication",
  "communications": "Communication",
  "phone": "Communication",
  "internet": "Communication",
  "связь": "Communication",
  "rabitə": "Communication",
  "subscriptions": "Subscriptions",
  "subscription": "Subscriptions",
  "подписки": "Subscriptions",
  "подписка": "Subscriptions",
  "abunəliklər": "Subscriptions",
  "gifts": "Gifts",
  "gift": "Gifts",
  "подарки": "Gifts",
  "подарок": "Gifts",
  "hədiyyələr": "Gifts",
  "salary": "Salary",
  "wage": "Salary",
  "зарплата": "Salary",
  "maaş": "Salary",
  "freelance": "Freelance",
  "freelancing": "Freelance",
  "фриланс": "Freelance",
  "frilansinq": "Freelance",
  "investments": "Investments",
  "investment": "Investments",
  "инвестиции": "Investments",
  "инвестиция": "Investments",
  "investisiyalar": "Investments",
  "other": "Other",
  "другое": "Other",
  "разное": "Other",
  "digər": "Other",
  "pets": "Pets",
  "pet": "Pets",
  "питомцы": "Pets",
  "питомец": "Pets",
  "beauty": "Beauty",
  "красота": "Beauty",
  "sports": "Sports",
  "sport": "Sports",
  "спорт": "Sports",
  "charity": "Charity",
  "donation": "Charity",
  "благотворительность": "Charity",
  "auto": "Auto",
  "car": "Auto",
  "авто": "Auto",
  "машина": "Auto",
  "home": "Home",
  "house": "Home",
  "дом": "Home",
};

function categoryAliasKey(name: string) {
  return name.trim().toLowerCase();
}

function normalizeCategoryNameToEnglish(name: string) {
  const trimmed = name.trim();
  return CATEGORY_NAME_ALIASES[categoryAliasKey(trimmed)] || trimmed;
}

function buildCategoryPromptList(userCategories: Array<{ name: string }>) {
  const canonicalNames = Array.from(
    new Set(userCategories.map((c) => normalizeCategoryNameToEnglish(c.name)).filter(Boolean))
  );
  return canonicalNames.length > 0 ? canonicalNames.map((name) => `"${name}"`).join(", ") : "(none)";
}

function findCategoryByCanonicalName<T extends { name: string }>(userCategories: T[], categoryName: string) {
  const canonicalName = normalizeCategoryNameToEnglish(categoryName);
  const canonicalKey = categoryAliasKey(canonicalName);
  return (
    userCategories.find((c) => categoryAliasKey(normalizeCategoryNameToEnglish(c.name)) === canonicalKey) ||
    userCategories.find((c) => {
      const existingKey = categoryAliasKey(normalizeCategoryNameToEnglish(c.name));
      return existingKey.includes(canonicalKey) || canonicalKey.includes(existingKey);
    })
  );
}

function getFallbackCategory<T extends { name: string }>(userCategories: T[]) {
  return findCategoryByCanonicalName(userCategories, "Other") || userCategories[userCategories.length - 1];
}

// Seed preset categories on startup
seedPresetCategories().catch(console.error);

// ─── Categories Router ───────────────────────────────────────────────
const categoriesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return getCategories(ctx.user.id);
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        icon: z.string().default("📦"),
        color: z.string().default("#6366f1"),
        type: z.enum(["income", "expense", "both"]).default("both"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const canonicalName = normalizeCategoryNameToEnglish(input.name);
      const existing = findCategoryByCanonicalName(await getCategories(ctx.user.id), canonicalName);
      if (existing) return { id: existing.id };

      return createCategory({
        ...input,
        name: canonicalName,
        userId: ctx.user.id,
        isPreset: false,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteCategory(input.id, ctx.user.id);
      return { success: true };
    }),
});

// ─── Transactions Router ─────────────────────────────────────────────
const transactionsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          familyGroupId: z.number().optional(),
          isFamily: z.boolean().optional(),
          isWork: z.boolean().optional(),
          businessGroupId: z.number().optional(),
          startDate: z.number().optional(),
          endDate: z.number().optional(),
          type: z.enum(["income", "expense"]).optional(),
          categoryId: z.number().optional(),
          limit: z.number().min(1).max(500).default(100),
          offset: z.number().min(0).default(0),
          scope: z.enum(["mine", "partner", "all"]).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (input?.familyGroupId) {
        const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
        if (!isMember) throw new TRPCError({ code: "FORBIDDEN", message: "Not a group member" });
      }

      // Handle family scope filtering (same logic as reports)
      if (input?.scope && input.scope !== "mine" && input?.familyGroupId) {
        const viewableIds = await getViewableUserIds(input.familyGroupId, ctx.user.id);
        let userIds: number[];
        if (input.scope === "partner") {
          userIds = viewableIds.filter((id) => id !== ctx.user.id);
        } else {
          // "all" — current user + viewable members
          userIds = Array.from(new Set([ctx.user.id, ...viewableIds]));
        }
        if (userIds.length === 0) userIds = [ctx.user.id];
        return getTransactions(ctx.user.id, { ...input, userIds });
      }

      return getTransactions(ctx.user.id, input ?? undefined);
    }),

  create: protectedProcedure
    .input(
      z.object({
        categoryId: z.number(),
        type: z.enum(["income", "expense"]),
        amount: z.string(),
        currency: z.string().default("AZN"),
        description: z.string().optional(),
        date: z.number(),
        isFamily: z.boolean().default(false),
        familyGroupId: z.number().optional().nullable(),
        isWork: z.boolean().default(false),
        businessGroupId: z.number().optional().nullable(),
        sourceLanguage: z.string().optional(),
        rawTranscription: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.isFamily && input.familyGroupId) {
        const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
        if (!isMember) throw new TRPCError({ code: "FORBIDDEN", message: "Not a group member" });
      }

      // Multi-currency conversion: convert to user's preferred currency
      const userCurrency = ctx.user.preferredCurrency || "AZN";
      const inputCurrency = input.currency || userCurrency;
      const inputAmount = parseFloat(input.amount);
      let finalAmount = input.amount;
      let originalAmount: string | null = null;
      let originalCurrency: string | null = null;
      let exchangeRate: string | null = null;

      if (inputCurrency.toUpperCase() !== userCurrency.toUpperCase()) {
        const conversion = await convertCurrency(inputAmount, inputCurrency, userCurrency, input.date);
        finalAmount = conversion.convertedAmount.toFixed(2);
        originalAmount = inputAmount.toFixed(2);
        originalCurrency = inputCurrency.toUpperCase();
        exchangeRate = conversion.exchangeRate.toFixed(8);
      }

      return createTransaction({
        ...input,
        amount: finalAmount,
        currency: userCurrency,
        originalAmount,
        originalCurrency,
        exchangeRate,
        userId: ctx.user.id,
        familyGroupId: input.isFamily ? (input.familyGroupId ?? null) : null,
        isWork: input.isWork ?? false,
        businessGroupId: input.isWork ? (input.businessGroupId ?? null) : null,
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        categoryId: z.number().optional(),
        type: z.enum(["income", "expense"]).optional(),
        amount: z.string().optional(),
        currency: z.string().optional(),
        description: z.string().optional(),
        date: z.number().optional(),
        isFamily: z.boolean().optional(),
        familyGroupId: z.number().optional().nullable(),
        isWork: z.boolean().optional(),
        businessGroupId: z.number().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      // Normalize: if isWork is explicitly set to false, clear businessGroupId
      if (data.isWork === false) {
        data.businessGroupId = null;
      }
      // Similarly, if isFamily is explicitly false, clear familyGroupId
      if (data.isFamily === false) {
        data.familyGroupId = null;
      }

      // Multi-currency conversion on update: if amount and currency are both provided
      const updateData: Record<string, unknown> = { ...data };
      if (data.amount && data.currency) {
        const userCurrency = ctx.user.preferredCurrency || "AZN";
        const inputCurrency = data.currency;
        const inputAmount = parseFloat(data.amount);

        if (inputCurrency.toUpperCase() !== userCurrency.toUpperCase()) {
          const conversion = await convertCurrency(inputAmount, inputCurrency, userCurrency, data.date);
          updateData.amount = conversion.convertedAmount.toFixed(2);
          updateData.currency = userCurrency;
          updateData.originalAmount = inputAmount.toFixed(2);
          updateData.originalCurrency = inputCurrency.toUpperCase();
          updateData.exchangeRate = conversion.exchangeRate.toFixed(8);
        } else {
          // Same currency: clear conversion fields
          updateData.originalAmount = null;
          updateData.originalCurrency = null;
          updateData.exchangeRate = null;
        }
      }

      await updateTransaction(id, ctx.user.id, updateData as any);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteTransaction(input.id, ctx.user.id);
      return { success: true };
    }),
});

// ─── Voice Router ────────────────────────────────────────────────────
const voiceRouter = router({
  transcribeAndParse: protectedProcedure
    .input(
      z.object({
        audioBase64: z.string(),
        language: z.string().optional(),
        mimeType: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Step 1: Transcribe audio from base64
      const audioBuffer = Buffer.from(input.audioBase64, "base64");
      const transcription = await transcribeAudio({
        audioBuffer,
        language: input.language,
        mimeType: input.mimeType,
      });

      if ("error" in transcription) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: transcription.error,
          cause: transcription,
        });
      }

      // Step 2: Get user's categories and business groups for context
      const userCategories = await getCategories(ctx.user.id);
      const categoryNames = buildCategoryPromptList(userCategories);
      const userBusinessGroups = await getBusinessGroups(ctx.user.id);
      const businessGroupNames = userBusinessGroups.length > 0
        ? userBusinessGroups.map((g, i) => `${i + 1}. "${g.name}"`).join(", ")
        : "(none)";

      // Step 3: Parse with LLM — supports MULTIPLE transactions in one voice message
      const now = new Date();
      const currentYear = now.getFullYear();
      const todayMs = now.getTime();
      const llmResult = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are a financial transaction parser. Extract structured data from the user's voice transcription.

**CRITICAL: The user may dictate MULTIPLE transactions in a single message.** Each distinct expense/income mentioned should be a separate transaction in the array. Look for conjunctions like "и" (and), "а также", "плюс", "ещё", commas separating amounts, or different budget contexts as signals of multiple transactions.

Available categories (canonical English names; choose one of these first when semantically appropriate): ${categoryNames}

CATEGORY LANGUAGE RULES:
- ALWAYS return categoryName in English, regardless of the transcription language.
- Match semantically across languages before creating a category. For example, Russian "авто" must match an existing "Auto" category, and Russian "еда" must match "Food".
- If none of the available categories fits well, create a new short descriptive category name in English and set newCategoryEmoji.
- Never return Russian, Azerbaijani, or mixed-language category names.

**IMPORTANT — TODAY'S DATE: ${now.toISOString()} (year ${currentYear})**
The current Unix timestamp in milliseconds is: ${todayMs}
You MUST use the year ${currentYear} for all dates. Do NOT use 2024 or any other year unless the user explicitly mentions a past year.

User's preferred currency: ${ctx.user.preferredCurrency || "AZN"}

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
  * If no currency mentioned, default to: ${ctx.user.preferredCurrency || "AZN"}
- Create a short description
- If no specific date mentioned, use today's timestamp: ${todayMs}
- The date field MUST be a Unix timestamp in milliseconds in the year ${currentYear}
- Detect the language of the transcription (ru, az, en)

BUDGET CONTEXT DETECTION (apply PER TRANSACTION — different transactions in the same message can have different budgets):
User's default budget: ${ctx.user.defaultBudget || "personal"}
User's business workspaces (numbered list): ${businessGroupNames}
- WORK triggers (any of these words/phrases → budgetContext="work"): "рабочий", "рабочие", "для работы", "для компании", "компания", "бизнес", "клиент", "проект", "офис", "iş", "iş xərci", "şirkət", "biznes", "work", "business", "company", "client", "project", "office", "corporate".
  When work is detected: look for a company/project name in the speech. If found, set businessGroupName to the EXACT name from the workspaces list above that best matches (fuzzy/partial match allowed). If no company name is mentioned, set businessGroupName to empty string "".
- FAMILY triggers (any of these → budgetContext="family"): "семейный", "семья", "для семьи", "ailə", "ailə xərci", "family", "для жены", "для мужа", "для детей", "домой"
- DEFAULT: If no work or family trigger is present → set budgetContext to "${ctx.user.defaultBudget || "personal"}"

EXAMPLES:
  "Рабочий расход для компании DM 15 евро такси" → 1 transaction: budgetContext="work", businessGroupName="DM"
  "потратил 50 манат на такси по работе в DM и 30 манат на продукты домой" → 2 transactions: [taxi 50 AZN work/DM, groceries 30 AZN family]
  "business lunch 30 USD and personal groceries 50" → 2 transactions: [lunch 30 USD work, groceries 50 personal]
  "зарплата 5000 и потратил 200 на одежду" → 2 transactions: [salary 5000 income, clothing 200 expense]

CATEGORY MATCHING RULES (apply these strictly and return the English name):
- Hotel minibar, hotel bar, hotel restaurant, room service → use "Restaurants" (NOT "Housing")
- Any food or drink purchase (cafe, coffee, restaurant, bar, minibar, snacks) → use "Restaurants"
- Hotel room/accommodation/rent/apartment payment → use "Housing"
- Taxi, uber, bus, metro, train, flight → use "Transport"
- Cinema, concert, club, entertainment venue → use "Entertainment"
- Grocery store, supermarket, food market → use "Food"
- Pharmacy, doctor, clinic, medicine → use "Health"
- Clothing store, shoes, fashion → use "Clothing"
- Internet, phone plan, mobile top-up → use "Communication"
- Netflix, Spotify, app subscription → use "Subscriptions"
- Gift, present → use "Gifts"
- Salary, wage → use "Salary"
- Freelance work payment → use "Freelance"
- Stock, crypto, investment → use "Investments"
- Vet, veterinary, pet care, pet food, pet supplies → NEW category "Pets" with emoji 🐾
- Beauty salon, haircut, spa, manicure, pedicure, cosmetics → NEW category "Beauty" with emoji 💅
- Sports, gym, fitness, swimming pool, yoga → NEW category "Sports" with emoji 🏋️
- Education, course, tuition, books, school, university → use or create "Education" with emoji 📚
- Charity, donation → NEW category "Charity" with emoji 🤝
- Car repair, car service, car wash, parking, fuel/gas → NEW category "Auto" with emoji 🚗
- Furniture, home goods, home repair, renovation → NEW category "Home" with emoji 🏠
- Anything else that does NOT fit any category above → create a NEW category with a short descriptive English name and an appropriate emoji

NEW CATEGORY RULE: If the transaction does NOT match any existing category well, set categoryName to a NEW descriptive English name (NOT "Other") and set newCategoryEmoji to a single appropriate emoji. The system will auto-create this category for the user.
If the transaction DOES match an existing category, set newCategoryEmoji to empty string "".

Always return a transactions array, even for a single transaction (array with one item).`,
          },
          {
            role: "user",
            content: `Parse ALL transactions from this voice transcription: "${transcription.text}"`,
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
                      currency: { type: "string", description: "Currency code (AZN, USD, EUR, RUB, etc.)" },
                      categoryName: { type: "string", description: "Best matching English category name from the available list, OR a new descriptive English name if nothing fits" },
                      newCategoryEmoji: { type: "string", description: "Single emoji for a new category if categoryName is NOT in the available list. Empty string if using an existing category." },
                      description: { type: "string", description: "Short description of the transaction" },
                      date: { type: "number", description: "Unix timestamp in milliseconds" },
                      budgetContext: { type: "string", enum: ["personal", "family", "work"], description: "Detected budget context for THIS transaction" },
                      businessGroupName: { type: "string", description: "Company/project name if budgetContext is work, else empty string" },
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
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to parse transaction" });
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

      // Helper: find existing category by semantic/canonical English name
      const findExistingCategory = (categoryName: string) => findCategoryByCanonicalName(userCategories, categoryName);

      // Helper: auto-create a new user category if it doesn't exist yet
      const autoCreateCategory = async (name: string, emoji: string) => {
        const canonicalName = normalizeCategoryNameToEnglish(name);
        const existing = findExistingCategory(canonicalName);
        if (existing) return existing;
        const result = await createCategory({
          name: canonicalName,
          icon: emoji || "📦",
          color: "#6366f1",
          type: "both",
          isPreset: false,
          userId: ctx.user.id,
        });
        if (!result) return userCategories[userCategories.length - 1];
        // Return a synthetic category object
        return {
          id: result.id,
          name: canonicalName,
          icon: emoji || "📦",
          color: "#6366f1",
          type: "both" as const,
          isPreset: false,
          userId: ctx.user.id,
          createdAt: new Date(),
        };
      };

      // Helper: match business group
      const matchBusinessGroup = (bgName: string) => {
        if (!bgName) return null;
        const lower = bgName.toLowerCase();
        return (
          userBusinessGroups.find((g) => g.name.toLowerCase() === lower) ||
          userBusinessGroups.find((g) => g.name.toLowerCase().includes(lower) || lower.includes(g.name.toLowerCase())) ||
          null
        );
      };

      // Process each transaction (async to support auto-category creation)
      const enrichedTransactions = await Promise.all(parsed.transactions.map(async (tx) => {
        // Date validation
        let fixedDate = tx.date;
        if (fixedDate) {
          const txDate = new Date(fixedDate);
          const txYear = txDate.getFullYear();
          if (txYear !== currentYear && txYear >= 2020 && txYear < currentYear) {
            txDate.setFullYear(currentYear);
            fixedDate = txDate.getTime();
            console.log(`[voice] Fixed LLM date from year ${txYear} to ${currentYear}: ${fixedDate}`);
          }
          if (fixedDate > todayMs + 86400000) {
            fixedDate = todayMs;
            console.log(`[voice] Date was in the future, reset to now: ${fixedDate}`);
          }
        } else {
          fixedDate = todayMs;
        }

        // Resolve category: use existing or auto-create new one
        let cat = findExistingCategory(tx.categoryName);
        if (!cat && tx.newCategoryEmoji) {
          // AI suggested a new category — auto-create it
          console.log(`[voice] Auto-creating category: "${tx.categoryName}" ${tx.newCategoryEmoji}`);
          cat = await autoCreateCategory(tx.categoryName, tx.newCategoryEmoji);
        }
        if (!cat) {
          // Last resort fallback to "Other" or last category
          cat = getFallbackCategory(userCategories);
        }

        const bg = tx.budgetContext === "work" ? matchBusinessGroup(tx.businessGroupName) : null;

        return {
          type: tx.type,
          amount: tx.amount,
          currency: tx.currency,
          categoryId: cat?.id,
          categoryName: cat?.name || tx.categoryName,
          categoryIcon: cat?.icon || "📦",
          description: tx.description,
          date: fixedDate,
          budgetContext: tx.budgetContext || ctx.user.defaultBudget || "personal",
          isFamily: tx.budgetContext === "family",
          isWork: tx.budgetContext === "work",
          businessGroupId: bg?.id ?? null,
          detectedBusinessGroupName: tx.businessGroupName || null,
        };
      }));

      // Backward-compatible response: if single transaction, also include flat `parsed` field
      const firstTx = enrichedTransactions[0];
      return {
        transcription: transcription.text,
        language: parsed.language || transcription.language,
        // Multi-transaction array (new)
        transactions: enrichedTransactions,
        // Single-transaction backward compat (old clients)
        parsed: firstTx ? {
          ...firstTx,
          language: parsed.language || transcription.language,
        } : {
          type: "expense" as const,
          amount: 0,
          currency: ctx.user.preferredCurrency || "AZN",
          categoryName: "Other",
          categoryIcon: "📦",
          description: "",
          date: todayMs,
          language: parsed.language || transcription.language,
          budgetContext: ctx.user.defaultBudget || "personal",
          isFamily: false,
          isWork: false,
          businessGroupId: null,
          detectedBusinessGroupName: null,
        },
        rawTranscription: transcription.text,
      };
    }),

  uploadAudio: protectedProcedure
    .input(
      z.object({
        audioBase64: z.string(),
        mimeType: z.string().default("audio/webm"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.audioBase64, "base64");
      const sizeMB = buffer.length / (1024 * 1024);
      if (sizeMB > 25) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Audio file too large (max 25MB)" });
      }

      // Return a temporary ID for the audio (stored in memory during transcription)
      const audioId = nanoid();
      return { audioId, size: buffer.length };
    }),

  // ─── Receipt / Screenshot Recognition ─────────────────────────────
  parseReceipt: protectedProcedure
    .input(
      z.object({
        imageBase64: z.string(),
        mimeType: z.string().default("image/jpeg"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.imageBase64, "base64");
      const sizeMB = buffer.length / (1024 * 1024);
      if (sizeMB > 10) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Image too large (max 10MB)" });
      }

      // Upload image to S3 for LLM access
      const { storagePut } = await import("./storage");
      const fileKey = `receipts/${ctx.user.id}-${nanoid()}.jpg`;
      const { url: imageUrl } = await storagePut(fileKey, buffer, input.mimeType);

      // Get user's categories for context
      const userCategories = await getCategories(ctx.user.id);
      const categoryNames = buildCategoryPromptList(userCategories);

      const now = new Date();
      const currentYear = now.getFullYear();
      const todayMs = now.getTime();
      const llmResult = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are a financial transaction image parser. Analyze the provided image and extract transaction data.

	Available categories (canonical English names; choose one of these first when semantically appropriate): ${categoryNames}

	CATEGORY LANGUAGE RULES:
	- ALWAYS return categoryName in English, regardless of the image language.
	- Match semantically across languages before creating a category. For example, Russian "авто" must match an existing "Auto" category, and Russian "еда" must match "Food".
	- If none of the available categories fits well, create a new short descriptive category name in English and set newCategoryEmoji.
	- Never return Russian, Azerbaijani, or mixed-language category names.

	**IMPORTANT — TODAY'S DATE: ${now.toISOString()} (year ${currentYear})**
The current Unix timestamp in milliseconds is: ${todayMs}
You MUST use the year ${currentYear} for all dates. Do NOT use 2024 or any other year unless the image explicitly shows a different year.

Default currency: ${ctx.user.preferredCurrency || "AZN"}

CRITICAL RULES — read carefully:

1. BANK/WALLET APP SCREENSHOT (e.g. Apple Wallet, bank app showing "Latest Transactions", transaction history list):
   → Extract EACH individual transaction as a SEPARATE entry in the transactions array.
   → Do NOT merge them into one. Each row in the list = one transaction object.
   → For relative dates ("3 hours ago", "Yesterday", "Sunday", "Saturday"), convert to absolute UTC timestamps using the current date: ${now.toISOString()} (year ${currentYear})

2. STORE RECEIPT / CASH REGISTER RECEIPT (кассовый чек — a paper receipt from a store/restaurant):
   → Extract ONLY the TOTAL/FINAL amount as a SINGLE transaction.
   → Use the store/merchant name as the description.
   → Do NOT create separate entries for individual line items.

For each transaction:
- type: "expense" for purchases/payments, "income" for deposits/refunds
- amount: numeric amount (positive number)
- currency: detect from image (default: ${ctx.user.preferredCurrency || "AZN"})
	- categoryName: best semantic match from available categories, returned in English
- description: merchant name or meaningful description
- date: UTC timestamp in milliseconds (MUST be in the year ${currentYear} unless the image shows a specific past date)
- confidence: "high"/"medium"/"low"

	CATEGORY MATCHING RULES (apply these strictly and return the English name):
	- Hotel minibar, hotel bar, hotel restaurant, room service -> use "Restaurants" (NOT "Housing")
	- Any food or drink purchase (cafe, coffee, restaurant, bar, minibar, snacks) -> use "Restaurants"
	- Hotel room/accommodation/rent/apartment payment -> use "Housing"
	- Taxi, uber, bus, metro, train, flight -> use "Transport"
	- Cinema, concert, club, entertainment venue -> use "Entertainment"
	- Grocery store, supermarket, food market -> use "Food"
	- Pharmacy, doctor, clinic, medicine -> use "Health"
	- Clothing store, shoes, fashion -> use "Clothing"
	- Internet, phone plan, mobile top-up -> use "Communication"
	- Netflix, Spotify, app subscription -> use "Subscriptions"
	- Gift, present -> use "Gifts"
	- Salary, wage -> use "Salary"
	- Freelance work payment -> use "Freelance"
	- Stock, crypto, investment -> use "Investments"
	- Vet, veterinary, pet care, pet food, pet supplies -> NEW category "Pets" with emoji 🐾
	- Beauty salon, haircut, spa, manicure, pedicure, cosmetics -> NEW category "Beauty" with emoji 💅
	- Sports, gym, fitness, swimming pool, yoga -> NEW category "Sports" with emoji 🏋️
	- Education, course, tuition, books, school, university -> use or create "Education" with emoji 📚
	- Charity, donation -> NEW category "Charity" with emoji 🤝
	- Car repair, car service, car wash, parking, fuel/gas -> NEW category "Auto" with emoji 🚗
	- Furniture, home goods, home repair, renovation -> NEW category "Home" with emoji 🏠
	- Anything else that does NOT fit any category above -> create a NEW category with a short descriptive English name and an appropriate emoji

	NEW CATEGORY RULE: If the transaction does NOT match any existing category well, set categoryName to a NEW descriptive English name (NOT "Other") and set newCategoryEmoji to a single appropriate emoji. The system will auto-create this category for the user.
	If the transaction DOES match an existing category, set newCategoryEmoji to empty string "".

Always return a transactions array, even for a single receipt (array with one item).`,
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: imageUrl, detail: "high" },
              },
              {
                type: "text",
                text: "Parse all transactions from this image. Return each transaction separately if this is a bank/wallet screenshot, or a single transaction with the total if this is a store receipt.",
              },
            ],
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
                imageType: {
                  type: "string",
                  enum: ["bank_screenshot", "store_receipt", "other"],
                  description: "Type of image detected",
                },
                transactions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      type: { type: "string", enum: ["income", "expense"] },
                      amount: { type: "number" },
                      currency: { type: "string" },
                      categoryName: { type: "string", description: "Best matching English category name, OR a new descriptive English name if nothing fits" },
                      newCategoryEmoji: { type: "string", description: "Single emoji for a new category if categoryName is NOT in the available list. Empty string if using an existing category." },
                      description: { type: "string" },
                      date: { type: "number", description: "UTC timestamp in milliseconds" },
                      confidence: { type: "string", enum: ["high", "medium", "low"] },
                    },
                    required: ["type", "amount", "currency", "categoryName", "newCategoryEmoji", "description", "date", "confidence"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["imageType", "transactions"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = llmResult.choices[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to parse receipt" });
      }

      const parsed = JSON.parse(content) as {
        imageType: "bank_screenshot" | "store_receipt" | "other";
        transactions: Array<{
          type: "income" | "expense";
          amount: number;
          currency: string;
          categoryName: string;
          newCategoryEmoji: string;
          description: string;
          date: number;
          confidence: "high" | "medium" | "low";
        }>;
      };

      // Server-side date validation: fix dates with wrong year from LLM
      for (const tx of parsed.transactions) {
        if (tx.date) {
          const txDate = new Date(tx.date);
          const txYear = txDate.getFullYear();
          if (txYear !== currentYear && txYear >= 2020 && txYear < currentYear) {
            txDate.setFullYear(currentYear);
            tx.date = txDate.getTime();
            console.log(`[receipt] Fixed LLM date from year ${txYear} to ${currentYear}: ${tx.date}`);
          }
          if (tx.date > todayMs + 86400000) {
            tx.date = todayMs;
            console.log(`[receipt] Date was in the future, reset to now: ${tx.date}`);
          }
        } else {
          tx.date = todayMs;
        }
      }

      // Resolve categories: find existing or auto-create new ones by canonical English name
      const findExistingCategoryReceipt = (categoryName: string) => findCategoryByCanonicalName(userCategories, categoryName);

      const autoCreateCategoryReceipt = async (name: string, emoji: string) => {
        const canonicalName = normalizeCategoryNameToEnglish(name);
        const existing = findExistingCategoryReceipt(canonicalName);
        if (existing) return existing;
        const result = await createCategory({
          name: canonicalName,
          icon: emoji || "📦",
          color: "#6366f1",
          type: "both",
          isPreset: false,
          userId: ctx.user.id,
        });
        if (!result) return userCategories[userCategories.length - 1];
        return {
          id: result.id,
          name: canonicalName,
          icon: emoji || "📦",
          color: "#6366f1",
          type: "both" as const,
          isPreset: false,
          userId: ctx.user.id,
          createdAt: new Date(),
        };
      };

      const enrichedTransactions = await Promise.all(parsed.transactions.map(async (tx) => {
        let cat = findExistingCategoryReceipt(tx.categoryName);
        if (!cat && tx.newCategoryEmoji) {
          console.log(`[receipt] Auto-creating category: "${tx.categoryName}" ${tx.newCategoryEmoji}`);
          cat = await autoCreateCategoryReceipt(tx.categoryName, tx.newCategoryEmoji);
        }
        if (!cat) {
          cat = getFallbackCategory(userCategories);
        }
        return {
          ...tx,
          categoryId: cat?.id,
          categoryName: cat?.name || tx.categoryName,
          categoryIcon: cat?.icon || "📦",
        };
      }));

      return {
        imageType: parsed.imageType,
        transactions: enrichedTransactions,
        imageUrl,
      };
    }),

  // ─── Bulk Save Receipt Transactions (with duplicate detection) ─────
  saveReceiptTransactions: protectedProcedure
    .input(
      z.object({
        transactions: z.array(
          z.object({
            categoryId: z.number(),
            type: z.enum(["income", "expense"]),
            amount: z.string(),
            currency: z.string().default("AZN"),
            description: z.string().optional(),
            date: z.number(),
            isFamily: z.boolean().default(false),
            familyGroupId: z.number().optional().nullable(),
            isWork: z.boolean().default(false),
            businessGroupId: z.number().optional().nullable(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch recent transactions for duplicate detection (last 90 days)
      const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const existing = await getTransactions(ctx.user.id, {
        startDate: ninetyDaysAgo,
        limit: 500,
      });

      const saved: number[] = [];
      const skipped: number[] = [];

      for (let i = 0; i < input.transactions.length; i++) {
        const tx = input.transactions[i];
        const txAmount = parseFloat(tx.amount);

        // Duplicate detection: same amount + same description (case-insensitive) within ±24h window
        const isDuplicate = existing.some((e) => {
          const existingAmount = parseFloat(e.transaction.amount);
          const amountMatch = Math.abs(existingAmount - txAmount) < 0.01;
          const descMatch =
            tx.description &&
            e.transaction.description &&
            e.transaction.description.toLowerCase().trim() === tx.description.toLowerCase().trim();
          const dateMatch = Math.abs(e.transaction.date - tx.date) < 24 * 60 * 60 * 1000;
          return amountMatch && descMatch && dateMatch;
        });

        if (isDuplicate) {
          skipped.push(i);
          continue;
        }

        // Multi-currency conversion
        const userCurrency = ctx.user.preferredCurrency || "AZN";
        const txCurrency = tx.currency || userCurrency;
        let finalAmount = tx.amount;
        let originalAmount: string | null = null;
        let originalCurrency: string | null = null;
        let txExchangeRate: string | null = null;

        if (txCurrency.toUpperCase() !== userCurrency.toUpperCase()) {
          const conversion = await convertCurrency(txAmount, txCurrency, userCurrency, tx.date);
          finalAmount = conversion.convertedAmount.toFixed(2);
          originalAmount = txAmount.toFixed(2);
          originalCurrency = txCurrency.toUpperCase();
          txExchangeRate = conversion.exchangeRate.toFixed(8);
        }

        await createTransaction({
          ...tx,
          amount: finalAmount,
          currency: userCurrency,
          originalAmount,
          originalCurrency,
          exchangeRate: txExchangeRate,
          userId: ctx.user.id,
          familyGroupId: tx.isFamily ? (tx.familyGroupId ?? null) : null,
          isWork: tx.isWork ?? false,
          businessGroupId: tx.isWork ? (tx.businessGroupId ?? null) : null,
        });
        saved.push(i);
      }

      return { saved: saved.length, skipped: skipped.length, skippedIndices: skipped };
    }),

  // ─── Check Duplicates (pre-save UI check) ─────────────────────────
  checkDuplicates: protectedProcedure
    .input(
      z.object({
        transactions: z.array(
          z.object({
            amount: z.string(),
            description: z.string().optional(),
            date: z.number(),
            type: z.enum(["income", "expense"]),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch recent transactions for duplicate detection (last 90 days)
      const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const existing = await getTransactions(ctx.user.id, {
        startDate: ninetyDaysAgo,
        limit: 500,
      });

      const duplicates: Array<{
        index: number;
        existingDescription: string;
        existingAmount: string;
        existingDate: number;
      }> = [];

      for (let i = 0; i < input.transactions.length; i++) {
        const tx = input.transactions[i];
        const txAmount = parseFloat(tx.amount);

        const match = existing.find((e) => {
          const existingAmount = parseFloat(e.transaction.amount);
          const amountMatch = Math.abs(existingAmount - txAmount) < 0.01;
          const descMatch =
            tx.description &&
            e.transaction.description &&
            e.transaction.description.toLowerCase().trim() === tx.description.toLowerCase().trim();
          const dateMatch = Math.abs(e.transaction.date - tx.date) < 24 * 60 * 60 * 1000;
          return amountMatch && descMatch && dateMatch;
        });

        if (match) {
          duplicates.push({
            index: i,
            existingDescription: match.transaction.description || "",
            existingAmount: match.transaction.amount,
            existingDate: match.transaction.date,
          });
        }
      }

      return { duplicates };
    }),
});

// ─── Reports Router ──────────────────────────────────────────────────
const reportsRouter = router({
  summary: protectedProcedure
    .input(
      z
        .object({
          startDate: z.number().optional(),
          endDate: z.number().optional(),
          familyGroupId: z.number().optional(),
          scope: z.enum(["mine", "partner", "all"]).optional(),
          isWork: z.boolean().optional(),
          businessGroupId: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (input?.familyGroupId) {
        const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
        if (!isMember) throw new TRPCError({ code: "FORBIDDEN" });
      }
      // Resolve scope to userIds for family reports, filtered by permissions
      let userIds: number[] | undefined;
      if (input?.familyGroupId && input?.scope) {
        // Get the list of members whose expenses I'm allowed to see
        const viewableIds = await getViewableUserIds(input.familyGroupId, ctx.user.id);
        if (input.scope === "mine") {
          userIds = [ctx.user.id];
        } else if (input.scope === "partner") {
          // Only show partners who have granted me access
          userIds = viewableIds.filter((id) => id !== ctx.user.id);
        } else {
          // "all" — show myself + everyone who granted me access
          userIds = viewableIds;
        }
      }
      return getReportSummary(ctx.user.id, { ...input, userIds });
    }),

  byCategory: protectedProcedure
    .input(
      z
        .object({
          startDate: z.number().optional(),
          endDate: z.number().optional(),
          familyGroupId: z.number().optional(),
          type: z.enum(["income", "expense"]).optional(),
          scope: z.enum(["mine", "partner", "all"]).optional(),
          isWork: z.boolean().optional(),
          businessGroupId: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (input?.familyGroupId) {
        const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
        if (!isMember) throw new TRPCError({ code: "FORBIDDEN" });
      }
      let userIds: number[] | undefined;
      if (input?.familyGroupId && input?.scope) {
        const viewableIds = await getViewableUserIds(input.familyGroupId, ctx.user.id);
        if (input.scope === "mine") {
          userIds = [ctx.user.id];
        } else if (input.scope === "partner") {
          userIds = viewableIds.filter((id) => id !== ctx.user.id);
        } else {
          userIds = viewableIds;
        }
      }
      return getReportByCategory(ctx.user.id, { ...input, userIds });
    }),

  // Debug endpoint to inspect raw transaction dates
  debugDates: protectedProcedure.query(async ({ ctx }) => {
    const txns = await getTransactions(ctx.user.id, { limit: 50 });
    const now = Date.now();
    return {
      currentTimeMs: now,
      currentTimeISO: new Date(now).toISOString(),
      sevenDaysAgoMs: now - 7 * 24 * 60 * 60 * 1000,
      thirtyDaysAgoMs: now - 30 * 24 * 60 * 60 * 1000,
      transactions: txns.map((t) => ({
        id: t.transaction.id,
        date: t.transaction.date,
        dateISO: new Date(t.transaction.date).toISOString(),
        dateIsSeconds: t.transaction.date < 1e11,
        dateIsMs: t.transaction.date >= 1e11,
        amount: t.transaction.amount,
        description: t.transaction.description,
        userId: t.transaction.userId,
        isFamily: t.transaction.isFamily,
      })),
    };
  }),

  exportCsv: protectedProcedure
    .input(
      z
        .object({
          startDate: z.number().optional(),
          endDate: z.number().optional(),
          familyGroupId: z.number().optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      if (input?.familyGroupId) {
        const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
        if (!isMember) throw new TRPCError({ code: "FORBIDDEN" });
      }
      const txns = await getTransactions(ctx.user.id, {
        ...input,
        limit: 5000,
      });

      const header = "Date,Type,Category,Amount,Currency,Original Amount,Original Currency,Exchange Rate,Description,Family,Work,Company\n";
      const rows = txns
        .map((t) => {
          const date = new Date(t.transaction.date).toISOString().split("T")[0];
          const desc = (t.transaction.description || "").replace(/"/g, '""');
          const catName = (t.categoryName || "").replace(/"/g, '""');
          const origAmt = t.transaction.originalAmount || "";
          const origCur = t.transaction.originalCurrency || "";
          const exRate = t.transaction.exchangeRate || "";
          return `${date},${t.transaction.type},"${catName}",${t.transaction.amount},${t.transaction.currency},${origAmt},${origCur},${exRate},"${desc}",${t.transaction.isFamily ? "Yes" : "No"},${t.transaction.isWork ? "Yes" : "No"},""`;
        })
        .join("\n");

      // UTF-8 BOM prefix ensures Excel and other spreadsheet apps correctly detect encoding
      // and display Cyrillic/Unicode characters properly with default (readable) formatting
      const bom = "\uFEFF";
      const csv = bom + header + rows;
      return { 
        csv,
        filename: `transactions_${new Date().toISOString().split("T")[0]}.csv`,
      };
    }),

  sendCsvToTelegram: protectedProcedure
    .input(
      z
        .object({
          startDate: z.number().optional(),
          endDate: z.number().optional(),
          familyGroupId: z.number().optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      if (input?.familyGroupId) {
        const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
        if (!isMember) throw new TRPCError({ code: "FORBIDDEN" });
      }

      const telegramId = ctx.user.telegramId;
      if (!telegramId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Telegram ID not found" });
      }

      const botToken = ENV.telegramBotToken;
      if (!botToken) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Bot token not configured" });
      }

      // Generate CSV (same logic as exportCsv)
      const txns = await getTransactions(ctx.user.id, {
        ...input,
        limit: 5000,
      });

      const header = "Date,Type,Category,Amount,Currency,Original Amount,Original Currency,Exchange Rate,Description,Family,Work,Company\n";
      const rows = txns
        .map((t) => {
          const date = new Date(t.transaction.date).toISOString().split("T")[0];
          const desc = (t.transaction.description || "").replace(/"/g, '""');
          const catName = (t.categoryName || "").replace(/"/g, '""');
          const origAmt = t.transaction.originalAmount || "";
          const origCur = t.transaction.originalCurrency || "";
          const exRate = t.transaction.exchangeRate || "";
          return `${date},${t.transaction.type},"${catName}",${t.transaction.amount},${t.transaction.currency},${origAmt},${origCur},${exRate},"${desc}",${t.transaction.isFamily ? "Yes" : "No"},${t.transaction.isWork ? "Yes" : "No"},""`;
        })
        .join("\n");

      const bom = "\uFEFF";
      const csvContent = bom + header + rows;
      const filename = `transactions_${new Date().toISOString().split("T")[0]}.csv`;

      // Send via Telegram Bot API sendDocument
      const formData = new FormData();
      formData.append("chat_id", telegramId);
      formData.append("document", new Blob([csvContent], { type: "text/csv;charset=utf-8" }), filename);
      formData.append("caption", `\u{1F4CA} Cashual — ${txns.length} transactions`);

      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendDocument`,
        { method: "POST", body: formData }
      );

      if (!response.ok) {
        const errBody = await response.text();
        console.error("[Telegram] sendDocument failed:", errBody);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to send file via Telegram" });
      }

      return { success: true, transactionCount: txns.length };
    }),
});

// ─── Family Router ───────────────────────────────────────────────────
const familyRouter = router({
  myGroups: protectedProcedure.query(async ({ ctx }) => {
    return getFamilyGroupsByUserId(ctx.user.id);
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      // Enforce one-family-per-user: check if user already belongs to any group
      const existingGroups = await getFamilyGroupsByUserId(ctx.user.id);
      if (existingGroups.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Вы уже состоите в семейной группе. Покиньте её перед созданием новой.",
        });
      }
      const inviteCode = nanoid(8).toUpperCase();
      const result = await createFamilyGroup({
        name: input.name,
        inviteCode,
        ownerId: ctx.user.id,
      });
      // Auto-add the creator as a member so the group appears in myGroups
      if (result) {
        await joinFamilyGroup(result.id, ctx.user.id);
      }
      return result;
    }),

  join: protectedProcedure
    .input(z.object({ inviteCode: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const group = await getFamilyGroupByInviteCode(input.inviteCode.toUpperCase());
      if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid invite code" });
      await joinFamilyGroup(group.id, ctx.user.id);
      // Initialize default permissions (everyone can see everyone)
      await initializePermissionsForNewMember(group.id, ctx.user.id);
      return group;
    }),

  leave: protectedProcedure
    .input(z.object({ familyGroupId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await leaveFamilyGroup(input.familyGroupId, ctx.user.id);
      return { success: true };
    }),

  members: protectedProcedure
    .input(z.object({ familyGroupId: z.number() }))
    .query(async ({ ctx, input }) => {
      const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
      if (!isMember) throw new TRPCError({ code: "FORBIDDEN" });
      return getFamilyGroupMembers(input.familyGroupId);
    }),

  // Get permissions I've set (who can see MY expenses)
  myPermissions: protectedProcedure
    .input(z.object({ familyGroupId: z.number() }))
    .query(async ({ ctx, input }) => {
      const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
      if (!isMember) throw new TRPCError({ code: "FORBIDDEN" });
      return getMyPermissions(input.familyGroupId, ctx.user.id);
    }),

  // Set permission: allow/deny a specific member from seeing my expenses
  setPermission: protectedProcedure
    .input(
      z.object({
        familyGroupId: z.number(),
        granteeId: z.number(),
        canViewExpenses: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
      if (!isMember) throw new TRPCError({ code: "FORBIDDEN" });
      // Grantor is always the current user
      await setFamilyPermission(
        input.familyGroupId,
        ctx.user.id,
        input.granteeId,
        input.canViewExpenses
      );
      return { success: true };
    }),

  // Get which user IDs I can view in a family group (for reports)
  viewableMembers: protectedProcedure
    .input(z.object({ familyGroupId: z.number() }))
    .query(async ({ ctx, input }) => {
      const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
      if (!isMember) throw new TRPCError({ code: "FORBIDDEN" });
      return getViewableUserIds(input.familyGroupId, ctx.user.id);
    }),
});

// ─── User Settings Router ────────────────────────────────────────────
const settingsRouter = router({
  update: protectedProcedure
    .input(
      z.object({
        preferredLanguage: z.string().optional(),
        preferredCurrency: z.string().optional(),
        defaultBudget: z.enum(["personal", "family"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await updateUserTelegram(ctx.user.id, input);
      return { success: true };
    }),

  deleteAllData: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      // Delete all user's transactions
      const result = await db
        .delete(transactions)
        .where(eq(transactions.userId, ctx.user.id));

      // Delete user's custom categories (keep presets)
      await db
        .delete(categories)
        .where(and(eq(categories.userId, ctx.user.id), eq(categories.isPreset, false)));

      return { success: true, deletedCount: (result as any)[0]?.affectedRows ?? 0 };
    }),
});

// ─── Business Router ───────────────────────────────────────────────
const businessRouter = router({
  myGroups: protectedProcedure.query(async ({ ctx }) => {
    return getBusinessGroups(ctx.user.id);
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        icon: z.string().default("💼"),
        color: z.string().default("#0ea5e9"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createBusinessGroup({ ...input, userId: ctx.user.id });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(128).optional(),
        icon: z.string().optional(),
        color: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await updateBusinessGroup(id, ctx.user.id, data);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteBusinessGroup(input.id, ctx.user.id);
      return { success: true };
    }),
});

// ─── AI Advisor Router ────────────────────────────────────────────────────────

/**
 * Build the full financial context for the AI advisor.
 * Crucially, fetches transactions from ALL viewable family members (not just the current user)
 * so the AI can compare spending between family members.
 */
async function buildAiContext(userId: number, userCurrency: string) {
  // 1. Fetch family groups and members
  const familyGroupsList = await getFamilyGroupsByUserId(userId);

  // 2. Collect all viewable user IDs across all family groups
  const allViewableUserIds = new Set<number>([userId]);
  const familyGroupsWithMembers: { id: number; name: string; members: { id: number; name: string }[] }[] = [];

  for (const group of familyGroupsList) {
    const viewableIds = await getViewableUserIds(group.group.id, userId);
    // Always include the current user + all viewable members
    const memberIds = Array.from(new Set([userId, ...viewableIds]));
    memberIds.forEach((id) => allViewableUserIds.add(id));

    // Get member names for context
    const memberRows = await getFamilyGroupMembers(group.group.id);
    const memberList = memberRows.map((m) => ({
      id: m.user.id,
      name: m.user.name || m.user.telegramFirstName || "User",
    }));
    familyGroupsWithMembers.push({
      id: group.group.id,
      name: group.group.name,
      members: memberList,
    });
  }

  // 3. Fetch ALL transactions from all viewable family members
  const userIdsArray = Array.from(allViewableUserIds);
  const allTransactions = await getTransactions(userId, {
    limit: 500,
    userIds: userIdsArray,
  });

  // 4. Fetch categories and business groups
  const userCategories = await getCategories(userId);
  const businessGroupsList = await getBusinessGroups(userId);

  // 5. Build summaries
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;

  const last30 = allTransactions.filter((t) => t.transaction.date >= thirtyDaysAgo);
  const last90 = allTransactions.filter((t) => t.transaction.date >= ninetyDaysAgo);

  const income30 = last30.filter((t) => t.transaction.type === "income").reduce((s, t) => s + parseFloat(String(t.transaction.amount)), 0);
  const expense30 = last30.filter((t) => t.transaction.type === "expense").reduce((s, t) => s + parseFloat(String(t.transaction.amount)), 0);
  const income90 = last90.filter((t) => t.transaction.type === "income").reduce((s, t) => s + parseFloat(String(t.transaction.amount)), 0);
  const expense90 = last90.filter((t) => t.transaction.type === "expense").reduce((s, t) => s + parseFloat(String(t.transaction.amount)), 0);

  // 6. Category breakdown for last 30 days
  const categoryBreakdown30: Record<string, { total: number; count: number }> = {};
  for (const t of last30.filter((t) => t.transaction.type === "expense")) {
    const catName = t.categoryName || "Без категории";
    if (!categoryBreakdown30[catName]) categoryBreakdown30[catName] = { total: 0, count: 0 };
    categoryBreakdown30[catName].total += parseFloat(String(t.transaction.amount));
    categoryBreakdown30[catName].count++;
  }

  // 7. Per-member expense breakdown for last 30 days
  const memberBreakdown30: Record<string, { income: number; expense: number }> = {};
  for (const t of last30) {
    const memberName = t.userName || "Unknown";
    if (!memberBreakdown30[memberName]) memberBreakdown30[memberName] = { income: 0, expense: 0 };
    const amt = parseFloat(String(t.transaction.amount));
    if (t.transaction.type === "income") memberBreakdown30[memberName].income += amt;
    else memberBreakdown30[memberName].expense += amt;
  }

  // 8. Build transaction list for context (last 150 for detail, with createdBy)
  const recentTxList = allTransactions.slice(0, 150).map((t) => ({
    date: new Date(t.transaction.date).toISOString().split("T")[0],
    type: t.transaction.type,
    amount: parseFloat(String(t.transaction.amount)),
    currency: t.transaction.currency,
    category: t.categoryName || "N/A",
    description: t.transaction.description || "",
    createdBy: t.userName || "Unknown",
    isWork: t.transaction.isWork,
    isFamily: t.transaction.isFamily,
    businessGroupId: t.transaction.businessGroupId,
  }));

  return JSON.stringify({
    userCurrency,
    totalTransactions: allTransactions.length,
    isFamilyAccount: familyGroupsWithMembers.length > 0,
    summary30days: { income: income30, expense: expense30, balance: income30 - expense30 },
    summary90days: { income: income90, expense: expense90, balance: income90 - expense90 },
    memberBreakdown30days: Object.entries(memberBreakdown30).map(([name, data]) => ({ member: name, ...data })),
    categoryBreakdown30days: Object.entries(categoryBreakdown30)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, data]) => ({ category: name, total: data.total, count: data.count })),
    businessGroups: businessGroupsList.map((g) => ({ id: g.id, name: g.name })),
    familyGroups: familyGroupsWithMembers,
    categories: userCategories.map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
    recentTransactions: recentTxList,
    currentDate: new Date().toISOString().split("T")[0],
  });
}

function buildSystemPrompt(contextData: string, userCurrency: string, userLang: string) {
  const langInstruction =
    userLang === "ru"
      ? "Отвечай на русском языке."
      : userLang === "az"
        ? "Azərbaycan dilində cavab ver."
        : "Respond in English.";

  return `You are CA$HUAL AI — a smart financial advisor and reporting assistant inside a personal finance app. You have access to the user's real transaction data, including transactions from ALL family members.

${langInstruction}

IMPORTANT: The context includes transactions from ALL family members. Each transaction has a "createdBy" field with the member's name. Use this to compare spending between family members when asked.

Your capabilities:
1. **Answer questions about spending/income** — analyze the data and give precise numbers with breakdowns
2. **Generate reports** — summarize by period, category, budget type (personal/family/work)
3. **Compare family members** — group transactions by "createdBy" to show each member's spending/income separately
4. **Provide financial advice** — identify spending patterns, suggest savings, warn about overspending
5. **Compare periods** — show differences between months/weeks
6. **Calculate averages** — daily/weekly/monthly averages

Formatting rules:
- Use Markdown formatting for readability
- Use **bold** for key numbers and totals
- Use bullet points or numbered lists for breakdowns
- Use emoji sparingly for visual appeal (💰 📈 📉 📊 ✅ ⚠️ 💡)
- Keep responses concise but informative (max 600 words)
- Always include specific numbers from the user's data
- When giving advice, be practical and actionable
- Currency: ${userCurrency}

User's financial data context (includes ALL family members' transactions):
${contextData}`;
}

const aiAdvisorRouter = router({
  ask: protectedProcedure
    .input(
      z.object({
        question: z.string().min(1).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const userCurrency = (ctx.user as any).preferredCurrency || "AZN";
      const userLang = (ctx.user as any).preferredLanguage || "ru";

      const contextData = await buildAiContext(userId, userCurrency);
      const systemPrompt = buildSystemPrompt(contextData, userCurrency, userLang);

      const llmResult = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: input.question },
        ],
        max_tokens: 2048,
      });

      const response = llmResult.choices[0]?.message?.content;
      if (!response) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI failed to generate response" });
      }

      return { response, question: input.question };
    }),

  transcribeAndAsk: protectedProcedure
    .input(
      z.object({
        audioBase64: z.string(),
        language: z.string().optional(),
        mimeType: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Step 1: Transcribe audio
      const audioBuffer = Buffer.from(input.audioBase64, "base64");
      const transcription = await transcribeAudio({
        audioBuffer,
        language: input.language,
        mimeType: input.mimeType,
      });

      if ("error" in transcription) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: transcription.error,
        });
      }

      // Step 2: Build context and call AI (same logic as ask)
      const userId = ctx.user.id;
      const userCurrency = (ctx.user as any).preferredCurrency || "AZN";
      const userLang = (ctx.user as any).preferredLanguage || "ru";

      const contextData = await buildAiContext(userId, userCurrency);
      const systemPrompt = buildSystemPrompt(contextData, userCurrency, userLang);

      const llmResult = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: transcription.text },
        ],
        max_tokens: 2048,
      });

      const response = llmResult.choices[0]?.message?.content;
      if (!response) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI failed to generate response" });
      }

      return { response, question: transcription.text, transcription: transcription.text };
    }),
});

// ─── Main Router ─────────────────────────────────────────────────────────────
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  categories: categoriesRouter,
  transactions: transactionsRouter,
  voice: voiceRouter,
  reports: reportsRouter,
  family: familyRouter,
  settings: settingsRouter,
  business: businessRouter,
  aiAdvisor: aiAdvisorRouter,
});

export type AppRouter = typeof appRouter;