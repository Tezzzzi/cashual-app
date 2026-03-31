/**
 * Unified auth hook for Cashual Telegram Mini App.
 * All pages use this hook - it delegates to useTelegramAuth internally.
 */
import { useTelegramAuth } from "./useTelegramAuth";
import { trpc } from "@/lib/trpc";
import { useCallback } from "react";

export function useAuth() {
  const telegramAuth = useTelegramAuth();
  const utils = trpc.useUtils();

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // ignore logout errors
    } finally {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  return {
    user: telegramAuth.user,
    loading: telegramAuth.loading,
    error: telegramAuth.error,
    isAuthenticated: telegramAuth.isAuthenticated,
    logout,
    refresh: () => utils.auth.me.invalidate(),
  };
}
