import { useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Wallet,
  Plus,
  Loader2,
  LogIn,
} from "lucide-react";
import { getLoginUrl } from "@/const";
import VoiceRecorder from "@/components/VoiceRecorder";
import TransactionForm from "@/components/TransactionForm";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [voiceResult, setVoiceResult] = useState<any>(null);

  const { data: summary, isLoading: summaryLoading } =
    trpc.reports.summary.useQuery(undefined, { enabled: isAuthenticated });

  const { data: recentTxns, isLoading: txnsLoading } =
    trpc.transactions.list.useQuery(
      { limit: 5 },
      { enabled: isAuthenticated }
    );

  const handleVoiceResult = (result: any) => {
    setVoiceResult(result);
    setShowAddDialog(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 gap-6">
        <div className="w-20 h-20 rounded-2xl bg-primary/20 flex items-center justify-center">
          <Wallet className="h-10 w-10 text-primary" />
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Voice Finance</h1>
          <p className="text-muted-foreground text-sm">
            Голосовой финансовый трекер. Диктуйте расходы и доходы на русском,
            азербайджанском или английском.
          </p>
        </div>
        <Button asChild className="w-full max-w-xs h-12">
          <a href={getLoginUrl()}>
            <LogIn className="h-4 w-4 mr-2" />
            Войти
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Привет,</p>
          <h1 className="text-xl font-bold">
            {user?.telegramFirstName || user?.name || "Пользователь"}
          </h1>
        </div>
        <Button
          size="icon"
          variant="outline"
          className="rounded-full h-10 w-10"
          onClick={() => {
            setVoiceResult(null);
            setShowAddDialog(true);
          }}
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>

      {/* Balance Card */}
      <div className="tg-card bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10">
        <p className="text-xs text-muted-foreground mb-1">Общий баланс</p>
        <p className="text-3xl font-bold">
          {summaryLoading ? (
            <span className="inline-block w-32 h-9 bg-muted animate-pulse rounded" />
          ) : (
            <>
              {(summary?.balance ?? 0).toLocaleString("ru-RU", {
                minimumFractionDigits: 2,
              })}{" "}
              <span className="text-lg font-normal text-muted-foreground">
                {user?.preferredCurrency || "AZN"}
              </span>
            </>
          )}
        </p>
        <div className="flex gap-4 mt-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-income/20 flex items-center justify-center">
              <ArrowUpCircle className="h-4 w-4 text-income" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Доходы</p>
              <p className="text-sm font-semibold text-income">
                {summaryLoading ? "..." : (summary?.totalIncome ?? 0).toLocaleString("ru-RU", { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-expense/20 flex items-center justify-center">
              <ArrowDownCircle className="h-4 w-4 text-expense" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Расходы</p>
              <p className="text-sm font-semibold text-expense">
                {summaryLoading ? "..." : (summary?.totalExpense ?? 0).toLocaleString("ru-RU", { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Voice Recorder */}
      <div className="tg-card text-center">
        <p className="text-sm font-medium mb-3">Голосовой ввод</p>
        <VoiceRecorder onResult={handleVoiceResult} />
        <p className="text-[10px] text-muted-foreground mt-2">
          RU / AZ / EN
        </p>
      </div>

      {/* Recent Transactions */}
      <div className="tg-section">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Последние записи</h2>
          <a
            href="/transactions"
            className="text-xs text-primary font-medium"
          >
            Все →
          </a>
        </div>
        {txnsLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-14 bg-card rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : recentTxns && recentTxns.length > 0 ? (
          <div className="space-y-2">
            {recentTxns.map((t) => (
              <div
                key={t.transaction.id}
                className="tg-card flex items-center gap-3 py-3"
              >
                <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-lg">
                  {t.categoryIcon || "📦"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {t.transaction.description || t.categoryName || "Транзакция"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {t.categoryName} · {new Date(t.transaction.date).toLocaleDateString("ru-RU")}
                  </p>
                </div>
                <p
                  className={`text-sm font-semibold ${
                    t.transaction.type === "income"
                      ? "text-income"
                      : "text-expense"
                  }`}
                >
                  {t.transaction.type === "income" ? "+" : "-"}
                  {parseFloat(t.transaction.amount).toLocaleString("ru-RU", {
                    minimumFractionDigits: 2,
                  })}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="tg-card text-center py-8">
            <p className="text-sm text-muted-foreground">
              Нет записей. Начните с голосового ввода!
            </p>
          </div>
        )}
      </div>

      {/* Add Transaction Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md mx-auto max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {voiceResult ? "Подтвердите транзакцию" : "Новая транзакция"}
            </DialogTitle>
          </DialogHeader>
          {voiceResult && (
            <div className="bg-secondary/50 rounded-lg p-3 mb-2">
              <p className="text-xs text-muted-foreground mb-1">Распознано:</p>
              <p className="text-sm italic">"{voiceResult.transcription}"</p>
            </div>
          )}
          <TransactionForm
            initialData={
              voiceResult
                ? {
                    type: voiceResult.parsed.type,
                    amount: voiceResult.parsed.amount,
                    currency: voiceResult.parsed.currency,
                    categoryId: voiceResult.parsed.categoryId,
                    description: voiceResult.parsed.description,
                    date: voiceResult.parsed.date,
                  }
                : undefined
            }
            onSuccess={() => {
              setShowAddDialog(false);
              setVoiceResult(null);
            }}
            onCancel={() => {
              setShowAddDialog(false);
              setVoiceResult(null);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
