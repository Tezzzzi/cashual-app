import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { setStoredToken, getStoredToken, clearStoredToken } from "@/main";

type AuthState = "idle" | "authenticating" | "authenticated" | "error";

export function useTelegramAuth() {
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [error, setError] = useState<string | null>(null);
  const authAttempted = useRef(false);
  const utils = trpc.useUtils();

  // Check if we already have a stored token
  const hasStoredToken = Boolean(getStoredToken());

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    // Only auto-fetch if we have a stored token
    enabled: hasStoredToken || authState === "authenticated",
  });

  useEffect(() => {
    // Only attempt auth once
    if (authAttempted.current) return;
    authAttempted.current = true;

    const authenticate = async () => {
      // If we already have a stored token, check if it's still valid
      const existingToken = getStoredToken();
      if (existingToken) {
        try {
          const existingUser = await utils.auth.me.fetch();
          if (existingUser) {
            console.log("[Telegram Auth] Using existing valid token");
            setAuthState("authenticated");
            return;
          }
        } catch {
          // Token expired or invalid, clear it and re-auth
          console.warn("[Telegram Auth] Existing token invalid, re-authenticating");
          clearStoredToken();
        }
      }

      setAuthState("authenticating");

      // Get Telegram initData
      const getInitData = (): string => {
        return window.Telegram?.WebApp?.initData ?? "";
      };

      let initData = getInitData();

      // Wait briefly for Telegram SDK to initialize if needed
      if (!initData) {
        await new Promise<void>((resolve) => setTimeout(resolve, 800));
        initData = getInitData();
      }

      // If still no initData, we're running outside Telegram
      if (!initData) {
        console.warn("[Telegram Auth] No initData - running outside Telegram");
        setAuthState("error");
        setError("Откройте приложение через Telegram бота @cashual_bot");
        return;
      }

      console.log("[Telegram Auth] Authenticating with initData length:", initData.length);

      try {
        const response = await fetch("/api/telegram/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });

        const responseData = await response.json();

        if (!response.ok) {
          const errorMsg = responseData.error || "Ошибка авторизации";
          console.error("[Telegram Auth] Failed:", errorMsg, responseData.details);
          setError(errorMsg);
          setAuthState("error");
          return;
        }

        // Store the JWT token in localStorage
        if (responseData.token) {
          setStoredToken(responseData.token);
          console.log("[Telegram Auth] Token stored, user:", responseData.user?.name);
        }

        // Invalidate and refetch user data with the new token
        await utils.auth.me.invalidate();
        setAuthState("authenticated");
      } catch (err) {
        console.error("[Telegram Auth] Network error:", err);
        setError(err instanceof Error ? err.message : "Ошибка сети");
        setAuthState("error");
      }
    };

    authenticate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLoading =
    authState === "idle" ||
    authState === "authenticating" ||
    (authState === "authenticated" && meQuery.isLoading);

  const isAuthenticated = authState === "authenticated" && Boolean(meQuery.data);

  return {
    user: meQuery.data ?? null,
    loading: isLoading,
    error: error || (meQuery.error?.message ?? null),
    isAuthenticated,
    authState,
  };
}
