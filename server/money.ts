import { tryGetExchangeRate } from "./exchange-rates";

/**
 * Presenting stored amounts in the user's current display currency.
 *
 * Every transaction records the currency it was stored in. Changing
 * `preferredCurrency` does not — and must not — rewrite that history: the car
 * wash really was paid in EUR at that day's rate, and rewriting rows would lose
 * precision on every switch and make past totals unreproducible. So conversion
 * happens at read time, from each row's own currency.
 *
 * Before this existed, the UI printed the raw stored number next to whatever
 * currency the user currently preferred, so switching AZN→EUR turned a 50 AZN
 * expense into "50 EUR".
 */

export type MoneyRow = {
  amount: string | number;
  currency: string | null;
  /** Transaction timestamp in ms — the rate is taken as of this date. */
  date: number;
  originalAmount?: string | number | null;
  originalCurrency?: string | null;
};

export type DisplayAmount = {
  /** Value expressed in `currency`. */
  amount: number;
  /** What `amount` is denominated in — the display currency, or the row's own when conversion failed. */
  currency: string;
  /** False when no rate was available, so the caller must not label it as the display currency. */
  converted: boolean;
  /** True when the figure is the originally entered number, with no rounding. */
  exact: boolean;
};

const num = (v: string | number | null | undefined): number =>
  typeof v === "number" ? v : parseFloat(String(v ?? "0")) || 0;

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Day key used to batch rate lookups: one lookup per currency per day. */
function dayKey(ms: number): string {
  return new Date(ms).toISOString().split("T")[0] ?? "";
}

export function displayCurrencyOf(row: MoneyRow, displayCurrency: string): string {
  return (row.currency || displayCurrency).toUpperCase();
}

/**
 * Convert one row. Prefers the originally entered amount when it is already in
 * the display currency, which makes the round trip exact: entering 25 EUR while
 * preferring AZN and later switching to EUR shows 25.00, not 24.98 after a
 * double conversion.
 */
export async function toDisplayAmount(
  row: MoneyRow,
  displayCurrency: string
): Promise<DisplayAmount> {
  const display = displayCurrency.toUpperCase();
  const stored = (row.currency || display).toUpperCase();

  if (stored === display) {
    return { amount: round2(num(row.amount)), currency: display, converted: true, exact: true };
  }

  const originalCurrency = (row.originalCurrency || "").toUpperCase();
  if (originalCurrency === display && row.originalAmount != null) {
    return {
      amount: round2(num(row.originalAmount)),
      currency: display,
      converted: true,
      exact: true,
    };
  }

  const rate = await tryGetExchangeRate(stored, display, row.date);
  if (rate === null) {
    // No rate: show it honestly in its own currency rather than mislabelling it.
    return { amount: round2(num(row.amount)), currency: stored, converted: false, exact: true };
  }

  return {
    amount: round2(num(row.amount) * rate),
    currency: display,
    converted: true,
    exact: false,
  };
}

/**
 * Convert a list, looking each rate up once per currency and day.
 *
 * A naive `Promise.all(rows.map(toDisplayAmount))` had every row miss the rate
 * cache simultaneously — 50 transactions from the same day produced 50
 * identical HTTP requests, each able to stall the list for its 8s timeout.
 * Rows needing no lookup (same currency, or an original already in the display
 * currency) are resolved directly.
 */
export async function toDisplayAmounts(
  rows: MoneyRow[],
  displayCurrency: string
): Promise<DisplayAmount[]> {
  const display = displayCurrency.toUpperCase();
  const results = new Array<DisplayAmount>(rows.length);
  const needsRate = new Map<string, number[]>(); // "CUR:YYYY-MM-DD" -> row indexes

  rows.forEach((row, i) => {
    const stored = (row.currency || display).toUpperCase();
    const originalCurrency = (row.originalCurrency || "").toUpperCase();

    if (stored === display) {
      results[i] = { amount: round2(num(row.amount)), currency: display, converted: true, exact: true };
    } else if (originalCurrency === display && row.originalAmount != null) {
      results[i] = {
        amount: round2(num(row.originalAmount)),
        currency: display,
        converted: true,
        exact: true,
      };
    } else {
      const key = `${stored}:${dayKey(row.date)}`;
      const bucket = needsRate.get(key);
      if (bucket) bucket.push(i);
      else needsRate.set(key, [i]);
    }
  });

  await Promise.all(
    Array.from(needsRate.entries()).map(async ([key, indexes]) => {
      const stored = key.split(":")[0] ?? display;
      const rate = await tryGetExchangeRate(stored, display, rows[indexes[0]!]!.date);
      for (const i of indexes) {
        const row = rows[i]!;
        results[i] =
          rate === null
            ? { amount: round2(num(row.amount)), currency: stored, converted: false, exact: true }
            : {
                amount: round2(num(row.amount) * rate),
                currency: display,
                converted: true,
                exact: false,
              };
      }
    })
  );

  return results;
}

/** One bucket of pre-aggregated money, as produced by a GROUP BY in SQL. */
export type MoneyBucket = {
  total: string | number;
  currency: string | null;
  /** Any timestamp inside the bucket's day — the rate is taken as of this date. */
  date: number;
};

/**
 * Sum buckets into a single figure in the display currency.
 *
 * Reports previously ran `SUM(amount)` grouped only by type, adding AZN and EUR
 * together as bare numbers. Grouping by currency **and day** in SQL and
 * converting each bucket at that day's rate keeps a report total equal to the
 * sum of the rows it is made of.
 *
 * Returns `unconvertible` so a caller can tell the user the total is partial
 * rather than quietly under-reporting.
 */
export async function sumBuckets(
  buckets: MoneyBucket[],
  displayCurrency: string
): Promise<{ total: number; unconvertible: MoneyBucket[] }> {
  const display = displayCurrency.toUpperCase();
  const unconvertible: MoneyBucket[] = [];
  // Cache within the call so repeated (currency, day) pairs cost one lookup.
  const rates = new Map<string, number | null>();
  let total = 0;

  for (const bucket of buckets) {
    const from = (bucket.currency || display).toUpperCase();
    if (from === display) {
      total += num(bucket.total);
      continue;
    }

    const key = `${from}:${dayKey(bucket.date)}`;
    if (!rates.has(key)) {
      rates.set(key, await tryGetExchangeRate(from, display, bucket.date));
    }
    const rate = rates.get(key) ?? null;

    if (rate === null) {
      unconvertible.push(bucket);
      continue;
    }
    total += num(bucket.total) * rate;
  }

  return { total: round2(total), unconvertible };
}
