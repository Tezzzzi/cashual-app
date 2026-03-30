/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

// ─── Voice Finance Tracker Types ─────────────────────────────────────
export type TransactionType = "income" | "expense";

export type ParsedTransaction = {
  type: TransactionType;
  amount: number;
  currency: string;
  categoryName: string;
  description: string;
  date: number; // UTC timestamp ms
  language: string;
};

export type ReportSummary = {
  totalIncome: number;
  totalExpense: number;
  balance: number;
};

export type CategoryReport = {
  categoryId: number | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  type: "income" | "expense" | null;
  total: string;
  count: number;
};

export type Period = "week" | "month" | "year" | "all";
