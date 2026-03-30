// For Railway deployment, these are the required environment variables:
// - DATABASE_URL: MySQL connection string
// - JWT_SECRET: Session signing secret
// - TELEGRAM_BOT_TOKEN: Telegram bot token from BotFather
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
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
};
