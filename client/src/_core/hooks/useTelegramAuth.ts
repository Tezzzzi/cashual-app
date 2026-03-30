import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

export function useTelegramAuth() {
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const authenticate = async () => {
      try {
        // Get Telegram initData
        const initData = window.Telegram?.WebApp?.initData;

        if (!initData) {
          setError("Telegram WebApp not initialized");
          setIsInitializing(false);
          return;
        }

        // Send initData to backend for authentication
        const response = await fetch("/api/telegram/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ initData }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          setError(errorData.error || "Authentication failed");
          setIsInitializing(false);
          return;
        }

        // Refetch user data after authentication
        await meQuery.refetch();
        setIsInitializing(false);
      } catch (err) {
        console.error("[Telegram Auth] Error:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setIsInitializing(false);
      }
    };

    authenticate();
  }, [meQuery]);

  return {
    user: meQuery.data ?? null,
    loading: isInitializing || meQuery.isLoading,
    error: error || meQuery.error?.message || null,
    isAuthenticated: Boolean(meQuery.data),
  };
}
