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
  getUserFamilyGroups,
  joinFamilyGroup,
  leaveFamilyGroup,
  getFamilyGroupMembers,
  isGroupMember,
  updateUserTelegram,
} from "./db";
import { transcribeAudio } from "./_core/voiceTranscription";
import { invokeLLM } from "./_core/llm";
import { storagePut } from "./storage";

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
      return createCategory({
        ...input,
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
          startDate: z.number().optional(),
          endDate: z.number().optional(),
          type: z.enum(["income", "expense"]).optional(),
          categoryId: z.number().optional(),
          limit: z.number().min(1).max(500).default(100),
          offset: z.number().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (input?.familyGroupId) {
        const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
        if (!isMember) throw new TRPCError({ code: "FORBIDDEN", message: "Not a group member" });
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
        sourceLanguage: z.string().optional(),
        rawTranscription: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.isFamily && input.familyGroupId) {
        const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
        if (!isMember) throw new TRPCError({ code: "FORBIDDEN", message: "Not a group member" });
      }
      return createTransaction({
        ...input,
        userId: ctx.user.id,
        familyGroupId: input.familyGroupId ?? null,
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await updateTransaction(id, ctx.user.id, data);
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
        audioUrl: z.string(),
        language: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Step 1: Transcribe audio
      const transcription = await transcribeAudio({
        audioUrl: input.audioUrl,
        language: input.language,
        prompt: "Transcribe the user's financial transaction. The user may speak in Russian, Azerbaijani, or English. They will mention an amount, category, and description of a financial transaction.",
      });

      if ("error" in transcription) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: transcription.error,
          cause: transcription,
        });
      }

      // Step 2: Get user's categories for context
      const userCategories = await getCategories(ctx.user.id);
      const categoryNames = userCategories.map((c) => c.name).join(", ");

      // Step 3: Parse with LLM
      const now = new Date();
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
- Detect the language of the transcription (ru, az, en)`,
          },
          {
            role: "user",
            content: `Parse this transcription into a financial transaction: "${transcription.text}"`,
          },
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
                language: { type: "string", description: "Detected language code (ru, az, en)" },
              },
              required: ["type", "amount", "currency", "categoryName", "description", "date", "language"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = llmResult.choices[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to parse transaction" });
      }

      const parsed = JSON.parse(content);

      // Match category
      const matchedCategory = userCategories.find(
        (c) => c.name.toLowerCase() === parsed.categoryName.toLowerCase()
      ) || userCategories.find((c) => c.name.toLowerCase().includes(parsed.categoryName.toLowerCase())) || userCategories[userCategories.length - 1]; // fallback to "Другое"

      return {
        transcription: transcription.text,
        language: parsed.language || transcription.language,
        parsed: {
          ...parsed,
          categoryId: matchedCategory?.id,
          categoryName: matchedCategory?.name || parsed.categoryName,
          categoryIcon: matchedCategory?.icon || "📦",
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
      if (sizeMB > 16) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Audio file too large (max 16MB)" });
      }

      const ext = input.mimeType.includes("webm") ? "webm" : input.mimeType.includes("mp4") ? "m4a" : "wav";
      const key = `audio/${ctx.user.id}/${nanoid()}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      return { url, key };
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
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (input?.familyGroupId) {
        const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
        if (!isMember) throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getReportSummary(ctx.user.id, input ?? undefined);
    }),

  byCategory: protectedProcedure
    .input(
      z
        .object({
          startDate: z.number().optional(),
          endDate: z.number().optional(),
          familyGroupId: z.number().optional(),
          type: z.enum(["income", "expense"]).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (input?.familyGroupId) {
        const isMember = await isGroupMember(input.familyGroupId, ctx.user.id);
        if (!isMember) throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getReportByCategory(ctx.user.id, input ?? undefined);
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

      const header = "Date,Type,Category,Amount,Currency,Description,Family\n";
      const rows = txns
        .map((t) => {
          const date = new Date(t.transaction.date).toISOString().split("T")[0];
          const desc = (t.transaction.description || "").replace(/"/g, '""');
          return `${date},${t.transaction.type},${t.categoryName || ""},${t.transaction.amount},${t.transaction.currency},"${desc}",${t.transaction.isFamily ? "Yes" : "No"}`;
        })
        .join("\n");

      const csv = header + rows;
      const key = `exports/${ctx.user.id}/${nanoid()}.csv`;
      const { url } = await storagePut(key, csv, "text/csv");
      return { url, filename: `transactions_${new Date().toISOString().split("T")[0]}.csv` };
    }),
});

// ─── Family Router ───────────────────────────────────────────────────
const familyRouter = router({
  myGroups: protectedProcedure.query(async ({ ctx }) => {
    return getUserFamilyGroups(ctx.user.id);
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const inviteCode = nanoid(8).toUpperCase();
      return createFamilyGroup({
        name: input.name,
        inviteCode,
        ownerId: ctx.user.id,
      });
    }),

  join: protectedProcedure
    .input(z.object({ inviteCode: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const group = await getFamilyGroupByInviteCode(input.inviteCode.toUpperCase());
      if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid invite code" });
      await joinFamilyGroup(group.id, ctx.user.id);
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
});

// ─── User Settings Router ────────────────────────────────────────────
const settingsRouter = router({
  update: protectedProcedure
    .input(
      z.object({
        preferredLanguage: z.string().optional(),
        preferredCurrency: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await updateUserTelegram(ctx.user.id, input);
      return { success: true };
    }),
});

// ─── Main Router ─────────────────────────────────────────────────────
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
});

export type AppRouter = typeof appRouter;
