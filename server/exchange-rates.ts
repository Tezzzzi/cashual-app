/**
 * Exchange Rate Service
 * Uses fawazahmed0/currency-api (free, no API key, supports all currencies including AZN/RUB/GEL)
 * Caches rates in memory with 24h TTL to minimize API calls.
 */

interface RateCache {
  rates: Record<string, number>;
  fetchedAt: number;
}

// In-memory cache: key = "from_currency:date" (e.g. "azn:2025-04-25" or "azn:latest")
const cache = new Map<string, RateCache>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch exchange rates for a given base currency and date.
 * @param fromCurrency - Base currency code (e.g. "AZN", "USD")
 * @param date - Optional date string "YYYY-MM-DD" for historical rates. If omitted, uses latest.
 * @returns Record of target currency codes to rates (e.g. { eur: 0.50, usd: 0.59 })
 */
async function fetchRates(fromCurrency: string, date?: string): Promise<Record<string, number>> {
  const from = fromCurrency.toLowerCase();
  const cacheKey = `${from}:${date || "latest"}`;

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rates;
  }

  // Primary URL: pages.dev domain
  const baseUrl = date
    ? `https://${date}.currency-api.pages.dev/v1/currencies/${from}.min.json`
    : `https://latest.currency-api.pages.dev/v1/currencies/${from}.min.json`;

  // Fallback URL: jsdelivr CDN
  const fallbackUrl = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${from}.min.json`;

  let rates: Record<string, number> | null = null;

  for (const url of [baseUrl, fallbackUrl]) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json() as { date: string; [key: string]: unknown };
        const currencyRates = data[from] as Record<string, number> | undefined;
        if (currencyRates && typeof currencyRates === "object") {
          rates = currencyRates;
          break;
        }
      }
    } catch (err) {
      console.warn(`[exchange-rates] Failed to fetch from ${url}:`, (err as Error).message);
    }
  }

  if (!rates) {
    console.warn(`[exchange-rates] All sources failed for ${from}/${date || "latest"}, using fallback rates`);
    rates = getFallbackRates(from);
  }

  // Cache the result
  cache.set(cacheKey, { rates, fetchedAt: Date.now() });
  return rates;
}

/**
 * Hardcoded fallback rates (approximate) for when the API is unavailable.
 * Based on rates as of April 2026. These are rough approximations.
 */
function getFallbackRates(from: string): Record<string, number> {
  // All rates relative to 1 unit of the "from" currency
  const baseRatesInUsd: Record<string, number> = {
    azn: 0.588,
    usd: 1.0,
    eur: 1.136,
    rub: 0.0112,
    try: 0.0285,
    gel: 0.373,
    gbp: 1.352,
  };

  const fromRate = baseRatesInUsd[from] || 1.0;

  // Convert all to "from" base
  const result: Record<string, number> = {};
  for (const [currency, usdRate] of Object.entries(baseRatesInUsd)) {
    result[currency] = usdRate / fromRate;
  }
  return result;
}

/**
 * Get the exchange rate from one currency to another on a specific date.
 * @param fromCurrency - Source currency code (e.g. "AZN")
 * @param toCurrency - Target currency code (e.g. "EUR")
 * @param date - Optional date for historical rate (Date object or ms timestamp)
 * @returns The exchange rate (multiply fromAmount by this to get toAmount)
 */
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  date?: Date | number
): Promise<number> {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();

  // Same currency = no conversion needed
  if (from === to) return 1.0;

  // Format date for API
  let dateStr: string | undefined;
  if (date) {
    const d = typeof date === "number" ? new Date(date) : date;
    dateStr = d.toISOString().split("T")[0];
  }

  const rates = await fetchRates(from, dateStr);
  const rate = rates[to.toLowerCase()];

  if (rate && rate > 0) {
    return rate;
  }

  // If direct rate not found, try reverse lookup
  console.warn(`[exchange-rates] Direct rate ${from}→${to} not found, trying reverse`);
  const reverseRates = await fetchRates(to, dateStr);
  const reverseRate = reverseRates[from.toLowerCase()];

  if (reverseRate && reverseRate > 0) {
    return 1 / reverseRate;
  }

  // Last resort: try via USD as intermediary
  console.warn(`[exchange-rates] Trying ${from}→USD→${to} as intermediary`);
  const fromToUsd = await fetchRates(from, dateStr);
  const usdToTarget = await fetchRates("usd", dateStr);

  const fromUsdRate = fromToUsd["usd"];
  const usdTargetRate = usdToTarget[to.toLowerCase()];

  if (fromUsdRate && usdTargetRate) {
    return fromUsdRate * usdTargetRate;
  }

  console.error(`[exchange-rates] Could not determine rate for ${from}→${to}`);
  return 1.0; // Fallback: no conversion
}

/**
 * Convert an amount from one currency to another.
 * @returns { convertedAmount, exchangeRate }
 */
export async function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  date?: Date | number
): Promise<{ convertedAmount: number; exchangeRate: number }> {
  const exchangeRate = await getExchangeRate(fromCurrency, toCurrency, date);
  const convertedAmount = Math.round(amount * exchangeRate * 100) / 100; // Round to 2 decimal places
  return { convertedAmount, exchangeRate };
}
