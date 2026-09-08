// For Railway deployment, these are the required environment variables:
// - DATABASE_URL: MySQL connection string
// - JWT_SECRET: Session signing secret
// - TELEGRAM_BOT_TOKEN or BOT_TOKEN: Telegram bot token from BotFather
// - OPENAI_API_KEY: OpenAI API key for Whisper and GPT
// - NODE_ENV: "production" or "development"

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Telegram & OpenAI
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  // ─── AI providers ─────────────────────────────────────────────────
  // Two independent providers, selectable per task so their output can be
  // compared. Models are overridable without a code change because vendors
  // rename them; see server/_core/ai-provider.ts for the defaults.
  xaiApiKey: process.env.XAI_API_KEY ?? "",
  xaiChatModel: process.env.XAI_CHAT_MODEL ?? "",
  forgeChatModel: process.env.FORGE_CHAT_MODEL ?? "",
  // Defaults when the caller expresses no preference: per task, then global.
  aiProviderStt: process.env.AI_PROVIDER_STT ?? "",
  aiProviderChat: process.env.AI_PROVIDER_CHAT ?? "",
  aiProviderVision: process.env.AI_PROVIDER_VISION ?? "",
  aiProviderDefault: process.env.AI_PROVIDER_DEFAULT ?? "",
};
