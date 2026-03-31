export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// No-op for Telegram Mini App - auth is handled via Telegram initData
export const getLoginUrl = () => {
  return "https://t.me/cashua_appl_bot";
};
