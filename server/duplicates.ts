import { getTransactions } from "./db";

/**
 * Catching the same purchase recorded twice.
 *
 * The Apple Wallet automation fires when a card is tapped, not when the bank
 * approves, so a declined attempt is reported exactly like a successful one.
 * Paying again — often with a different card — fires it again. On 2026-09-29 a
 * single 85.36 EUR purchase was recorded three times across two minutes, and
 * four such groups accumulated in three weeks, overstating spending by 13%.
 *
 * Receipts had a check for this; voice and Wallet did not. One rule now covers
 * all three, with the window chosen per source.
 */

export type DuplicateSource = "wallet" | "voice" | "receipt";

export type CandidateTransaction = {
  amount: number;
  /** Merchant for Wallet, spoken text for voice, parsed line for receipts. */
  description?: string | null;
  currency?: string | null;
  /** When the purchase happened, in ms. */
  date: number;
  /** Card used, when the Shortcut supplies it. */
  card?: string | null;
};

/**
 * Wallet and voice repeats land within seconds; receipts are scanned later.
 *
 * Ten minutes rather than a day is deliberate: the real repeats measured 22 to
 * 84 seconds apart, while two genuine visits to the same shop for the same
 * amount on one day are perfectly ordinary and must not be swallowed.
 */
const WINDOW_MS: Record<DuplicateSource, number> = {
  wallet: 10 * 60 * 1000,
  voice: 10 * 60 * 1000,
  receipt: 24 * 60 * 60 * 1000,
};

const norm = (v?: string | null) => (v ?? "").toLowerCase().trim();

export type DuplicateMatch = {
  id: number;
  description: string | null;
  amount: string;
  date: number;
  /** True when the match came from a different card — a stronger signal, not a weaker one. */
  differentCard: boolean;
};

/**
 * Returns the existing transaction this one duplicates, or null.
 *
 * Currency must match: 5 EUR and 5 AZN are different purchases. Description
 * must match too — amount alone would swallow two unrelated purchases that
 * happen to cost the same.
 */
export async function findDuplicate(
  userId: number,
  candidate: CandidateTransaction,
  source: DuplicateSource
): Promise<DuplicateMatch | null> {
  const window = WINDOW_MS[source];
  const description = norm(candidate.description);

  // Without a description there is nothing to match on beyond the amount, and
  // that alone is too weak to justify discarding a transaction.
  if (!description) return null;

  const recent = await getTransactions(userId, {
    startDate: candidate.date - window,
    endDate: candidate.date + window,
    limit: 200,
  });

  for (const row of recent) {
    const existing = row.transaction;

    if (Math.abs(parseFloat(existing.amount) - candidate.amount) >= 0.01) continue;
    if (norm(existing.currency) !== norm(candidate.currency || existing.currency)) continue;
    if (Math.abs(existing.date - candidate.date) > window) continue;

    const existingDescription = norm(existing.description);
    // The card suffix is appended as "Merchant (Card)", so compare the merchant
    // part: paying the same amount at the same shop from a second card is the
    // retry case, and must still be recognised as a duplicate.
    const existingMerchant = existingDescription.replace(/\s*\([^)]*\)\s*$/, "");
    const candidateMerchant = description.replace(/\s*\([^)]*\)\s*$/, "");
    if (existingMerchant !== candidateMerchant) continue;

    return {
      id: existing.id,
      description: existing.description,
      amount: existing.amount,
      date: existing.date,
      differentCard: existingDescription !== description,
    };
  }

  return null;
}
