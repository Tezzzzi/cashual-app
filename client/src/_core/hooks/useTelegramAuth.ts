import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

type AuthState = "idle" | "authenticating" | "authenticated" | "error";

export function useTelegramAuth() {
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [error, setError] = useState<string | null>(null);
  const authAttempted = useRef(false);

  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    // Only auto-fetch if we might already have a session cookie
    staleTime: 30_000,
  });

  useEffect(() => {
    // Only attempt auth once
    if (authAttempted.current) return;
    authAttempted.current = true;

    const authenticate = async () => {
      setAuthState("authenticating");

      // Get Telegram initData - wait briefly for Telegram SDK to initialize
      const getInitData = (): string => {
        return window.Telegram?.WebApp?.initData ?? "";
      };

      let initData = getInitData();

      // If initData is empty, wait up to 500ms for Telegram SDK to load
      if (!initData) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        initData = getInitData();
      }

      // If still no initData, we're running outside Telegram
      // Try to use existing session cookie first
      if (!initData) {
        console.warn("[Telegram Auth] No initData - running outside Telegram or SDK not loaded");
        // Check if we have an existing valid session
        try {
          const existingUser = await utils.auth.me.fetch();
          if (existingUser) {
            setAuthState("authenticated");
            return;
          }
        } catch {
          // No existing session
        }
        // Allow app to load in "guest" mode for browser testing
        setAuthState("error");
        setError("Открой приложение через Telegram бота @cashua_appl_bot");
        return;
      }

      try {
        const response = await fetch("/api/telegram/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ initData }),
        });

        if (!response.ok) {
          let errorMsg = "Ошибка авторизации";
          try {
            const errorData = await response.json();
            errorMsg = errorData.error || errorMsg;
          } catch {
            // ignore JSON parse error
          }
          console.error("[Telegram Auth] Failed:", errorMsg);
          setError(errorMsg);
          setAuthState("error");
          return;
        }

        // Invalidate and refetch user data after successful auth
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
  }, []); // Empty deps - run once only

  const isLoading = authState === "idle" || authState === "authenticating" || meQuery.isLoading;
  const isAuthenticated = authState === "authenticated" && Boolean(meQuery.data);

  return {
    user: meQuery.data ?? null,
    loading: isLoading,
    error: error || (meQuery.error?.message ?? null),
    isAuthenticated,
    authState,
  };
}
