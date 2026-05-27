import { and, eq, gte, lt, sql } from "drizzle-orm";
import { categories, transactions, users } from "../drizzle/schema";
import { getDb } from "./db";
import { ENV } from "./_core/env";

const DEFAULT_TIME_ZONE = "Asia/Baku";
const CHECK_INTERVAL_MS = 60 * 1000;
const TOP_CATEGORY_LIMIT = 3;

type SupportedLanguage = "en" | "ru" | "az";
type ReminderKind = "morning" | "evening";

type ReminderUser = typeof users.$inferSelect;

type TopCategory = {
  name: string;
  total: number;
};

const categoryTranslations: Record<string, Record<SupportedLanguage, string>> = {
  Food: { en: "Food", ru: "Еда", az: "Ərzaq" },
  Transport: { en: "Transport", ru: "Транспорт", az: "Nəqliyyat" },
  Housing: { en: "Housing", ru: "Жильё и дом", az: "Mənzil və ev" },
  Entertainment: { en: "Entertainment", ru: "Развлечения", az: "Əyləncə" },
  Health: { en: "Health", ru: "Здоровье", az: "Sağlamlıq" },
  Clothing: { en: "Clothing", ru: "Одежда", az: "Geyim" },
  Education: { en: "Education", ru: "Образование", az: "Təhsil" },
  Restaurants: { en: "Restaurants", ru: "Рестораны", az: "Restoranlar" },
  Communication: { en: "Communication", ru: "Связь", az: "Rabitə" },
  Subscriptions: { en: "Subscriptions", ru: "Подписки", az: "Abunəliklər" },
  Gifts: { en: "Gifts", ru: "Подарки", az: "Hədiyyələr" },
  Salary: { en: "Salary", ru: "Зарплата", az: "Maaş" },
  Freelance: { en: "Freelance", ru: "Фриланс", az: "Frilansinq" },
  Investments: { en: "Investments", ru: "Инвестиции", az: "İnvestisiyalar" },
  Other: { en: "Other", ru: "Другое", az: "Digər" },
  Auto: { en: "Auto", ru: "Авто", az: "Avto" },
  Pets: { en: "Pets", ru: "Питомцы", az: "Ev heyvanları" },
  Beauty: { en: "Beauty", ru: "Красота", az: "Gözəllik" },
  Sports: { en: "Sports", ru: "Спорт", az: "İdman" },
  Electronics: { en: "Electronics", ru: "Электроника", az: "Elektronika" },
  Charity: { en: "Charity", ru: "Благотворительность", az: "Xeyriyyə" },
  Alimony: { en: "Alimony", ru: "Алименты", az: "Aliment" },
  "Parents Support": { en: "Parents Support", ru: "Помощь родителям", az: "Valideynlərə dəstək" },
};

const messages = {
  en: {
    evening: "You haven't recorded any expenses today. Don't forget to track your spending! 📝",
    morningPrefix: (amount: string, currency: string) => `Yesterday you spent ${amount} ${currency}.`,
    topCategories: "Top categories:",
    noCategories: "No expense categories recorded.",
  },
  ru: {
    evening: "Сегодня вы ещё не записали расходы. Не забудьте отслеживать траты! 📝",
    morningPrefix: (amount: string, currency: string) => `Вчера вы потратили ${amount} ${currency}.`,
    topCategories: "Топ категорий:",
    noCategories: "Категории расходов не записаны.",
  },
  az: {
    evening: "Bu gün hələ heç bir xərc qeyd etməmisiniz. Xərclərinizi izləməyi unutmayın! 📝",
    morningPrefix: (amount: string, currency: string) => `Dünən ${amount} ${currency} xərclədiniz.`,
    topCategories: "Ən çox kateqoriyalar:",
    noCategories: "Xərc kateqoriyası qeydə alınmayıb.",
  },
} satisfies Record<SupportedLanguage, {
  evening: string;
  morningPrefix: (amount: string, currency: string) => string;
  topCategories: string;
  noCategories: string;
}>;

let schedulerStarted = false;
let intervalHandle: NodeJS.Timeout | undefined;
const sentKeys = new Set<string>();

export function startReminderScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  if (!ENV.telegramBotToken) {
    console.warn("[Reminders] Telegram bot token is not configured; reminders will not be sent.");
  }

  void runReminderTick();
  intervalHandle = setInterval(() => {
    void runReminderTick();
  }, CHECK_INTERVAL_MS);

  console.log("[Reminders] Scheduler started");
}

export function stopReminderSchedulerForTests() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = undefined;
  schedulerStarted = false;
  sentKeys.clear();
}

async function runReminderTick(now = new Date()) {
  const db = await getDb();
  if (!db) return;
  if (!ENV.telegramBotToken) return;

  try {
    const reminderUsers = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.remindersEnabled, true),
          sql`${users.telegramId} IS NOT NULL`,
          sql`${users.telegramId} <> ''`
        )
      );

    for (const user of reminderUsers) {
      const timeZone = getUserTimeZone(user.timezone);
      const localNow = getZonedParts(now, timeZone);
      const language = normalizeLanguage(user.preferredLanguage);

      if (localNow.hour === 9 && localNow.minute === 0) {
        await maybeSendReminder(user, "morning", language, timeZone, now);
      }

      if (localNow.hour === 21 && localNow.minute === 0) {
        await maybeSendReminder(user, "evening", language, timeZone, now);
      }
    }
  } catch (error) {
    console.error("[Reminders] Tick failed:", error);
  }
}

async function maybeSendReminder(
  user: ReminderUser,
  kind: ReminderKind,
  language: SupportedLanguage,
  timeZone: string,
  now: Date
) {
  const localDateKey = getLocalDateKey(now, timeZone);
  const sentKey = `${kind}:${user.id}:${localDateKey}`;
  if (sentKeys.has(sentKey)) return;

  if (kind === "evening") {
    const hasTransactionsToday = await userHasTransactionsForLocalDay(user.id, timeZone, 0, now);
    if (hasTransactionsToday) {
      sentKeys.add(sentKey);
      return;
    }
    await sendTelegramMessage(user.telegramId!, messages[language].evening);
    sentKeys.add(sentKey);
    return;
  }

  const summary = await getYesterdayExpenseSummary(user.id, timeZone, now);
  const text = formatMorningSummary(summary.total, user.preferredCurrency || "EUR", summary.topCategories, language);
  await sendTelegramMessage(user.telegramId!, text);
  sentKeys.add(sentKey);
}

async function userHasTransactionsForLocalDay(
  userId: number,
  timeZone: string,
  dayOffset: number,
  now: Date
) {
  const db = await getDb();
  if (!db) return false;
  const { startMs, endMs } = getLocalDayBoundsMs(now, timeZone, dayOffset);
  const result = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.date, startMs),
        lt(transactions.date, endMs)
      )
    )
    .limit(1);

  return result.length > 0;
}

async function getYesterdayExpenseSummary(userId: number, timeZone: string, now: Date) {
  const db = await getDb();
  if (!db) return { total: 0, topCategories: [] as TopCategory[] };
  const { startMs, endMs } = getLocalDayBoundsMs(now, timeZone, -1);

  const rows = await db
    .select({
      categoryName: categories.name,
      total: sql<string>`CAST(SUM(${transactions.amount}) AS CHAR)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, "expense"),
        gte(transactions.date, startMs),
        lt(transactions.date, endMs)
      )
    )
    .groupBy(categories.name)
    .orderBy(sql`SUM(${transactions.amount}) DESC`);

  const categoryTotals = rows.map((row) => ({
    name: row.categoryName || "Other",
    total: Number.parseFloat(row.total || "0"),
  }));

  const total = categoryTotals.reduce((sum, category) => sum + category.total, 0);
  return { total, topCategories: categoryTotals.slice(0, TOP_CATEGORY_LIMIT) };
}

function formatMorningSummary(
  total: number,
  currency: string,
  topCategories: TopCategory[],
  language: SupportedLanguage
) {
  const amount = formatAmount(total);
  const prefix = messages[language].morningPrefix(amount, currency);

  if (topCategories.length === 0 || total === 0) {
    return `${prefix} ${messages[language].noCategories}`;
  }

  const categoryText = topCategories
    .map((category) => `${translateCategory(category.name, language)} (${formatAmount(category.total)})`)
    .join(", ");

  return `${prefix} ${messages[language].topCategories} ${categoryText}.`;
}

async function sendTelegramMessage(chatId: string, text: string) {
  const response = await fetch(`https://api.telegram.org/bot${ENV.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed: ${response.status} ${errorText}`);
  }
}

function normalizeLanguage(language?: string | null): SupportedLanguage {
  if (language === "en" || language === "ru" || language === "az") return language;
  return "en";
}

function translateCategory(categoryName: string, language: SupportedLanguage) {
  return categoryTranslations[categoryName]?.[language] || categoryName;
}

function formatAmount(value: number) {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return rounded.toLocaleString("en-US", {
    minimumFractionDigits: rounded % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function getUserTimeZone(timeZone?: string | null) {
  if (timeZone && isValidTimeZone(timeZone)) return timeZone;
  return DEFAULT_TIME_ZONE;
}

function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function getLocalDateKey(date: Date, timeZone: string) {
  const parts = getZonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getLocalDayBoundsMs(date: Date, timeZone: string, dayOffset: number) {
  const local = getZonedParts(date, timeZone);
  const targetLocalDate = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset));
  const year = targetLocalDate.getUTCFullYear();
  const month = targetLocalDate.getUTCMonth() + 1;
  const day = targetLocalDate.getUTCDate();

  const startMs = zonedDateTimeToUtcMs(timeZone, year, month, day, 0, 0, 0);
  const nextLocalDate = new Date(Date.UTC(year, month - 1, day + 1));
  const endMs = zonedDateTimeToUtcMs(
    timeZone,
    nextLocalDate.getUTCFullYear(),
    nextLocalDate.getUTCMonth() + 1,
    nextLocalDate.getUTCDate(),
    0,
    0,
    0
  );

  return { startMs, endMs };
}

function zonedDateTimeToUtcMs(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
) {
  const localAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  let utcMs = localAsUtcMs;

  for (let i = 0; i < 3; i++) {
    const offsetMs = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
    const adjustedUtcMs = localAsUtcMs - offsetMs;
    if (adjustedUtcMs === utcMs) break;
    utcMs = adjustedUtcMs;
  }

  return utcMs;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getZonedParts(date, timeZone);
  const localAsUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return localAsUtcMs - date.getTime();
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const hour = Number.parseInt(parts.hour || "0", 10);

  return {
    year: Number.parseInt(parts.year || "1970", 10),
    month: Number.parseInt(parts.month || "1", 10),
    day: Number.parseInt(parts.day || "1", 10),
    hour: hour === 24 ? 0 : hour,
    minute: Number.parseInt(parts.minute || "0", 10),
    second: Number.parseInt(parts.second || "0", 10),
  };
}
