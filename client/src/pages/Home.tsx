import { useState } from "react";
import { useTelegramAuth } from "@/_core/hooks/useTelegramAuth";
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
  Plus,
  Loader2,
  AlertCircle,
  ScanLine,
} from "lucide-react";

import VoiceRecorder from "@/components/VoiceRecorder";
import TransactionForm from "@/components/TransactionForm";
import ReceiptScanner from "@/components/ReceiptScanner";
import MultiTransactionReview, { type ReviewTransaction } from "@/components/MultiTransactionReview";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";

export default function Home() {
  const { user, loading, isAuthenticated, error, authState } = useTelegramAuth();
  const { t, translateCategory } = useLanguage();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showReceiptScanner, setShowReceiptScanner] = useState(false);
  const [voiceResult, setVoiceResult] = useState<any>(null);
  const [showMultiVoiceDialog, setShowMultiVoiceDialog] = useState(false);
  const [multiVoiceTransactions, setMultiVoiceTransactions] = useState<ReviewTransaction[]>([]);
  const [voiceTranscription, setVoiceTranscription] = useState<string>("");
  const utils = trpc.useUtils();

  const { data: familyGroups } = trpc.family.myGroups.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const familyGroupId = familyGroups?.[0]?.group?.id;

  const { data: summary, isLoading: summaryLoading } =
    trpc.reports.summary.useQuery(
      familyGroupId ? { familyGroupId, scope: "all" } : undefined,
      { enabled: isAuthenticated }
    );

  const { data: recentTxns, isLoading: txnsLoading } =
    trpc.transactions.list.useQuery(
      { limit: 5 },
      { enabled: isAuthenticated }
    );

  const saveMultiMutation = trpc.voice.saveReceiptTransactions.useMutation({
    onSuccess: (result) => {
      utils.transactions.list.invalidate();
      utils.reports.summary.invalidate();
      const msg =
        result.skipped > 0
          ? `${t("transaction_added")}: ${result.saved} (${result.skipped} duplicates skipped)`
          : `${t("transaction_added")}: ${result.saved}`;
      toast.success(msg);
      setShowMultiVoiceDialog(false);
      setMultiVoiceTransactions([]);
      setVoiceTranscription("");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleVoiceResult = (result: any) => {
    const transactions = result.transactions;
    if (transactions && transactions.length > 1) {
      setMultiVoiceTransactions(
        transactions.map((tx: any) => ({
          type: tx.type,
          amount: tx.amount,
          currency: tx.currency,
          categoryId: tx.categoryId,
          categoryName: tx.categoryName,
          categoryIcon: tx.categoryIcon || "📦",
          description: tx.description,
          date: tx.date,
          budgetContext: tx.budgetContext,
          isFamily: tx.isFamily,
          isWork: tx.isWork,
          businessGroupId: tx.businessGroupId,
          detectedBusinessGroupName: tx.detectedBusinessGroupName,
        }))
      );
      setVoiceTranscription(result.transcription || result.rawTranscription || "");
      setShowMultiVoiceDialog(true);
    } else {
      setVoiceResult(result);
      setShowAddDialog(true);
    }
  };

  const handleSaveMultiVoice = (
    transactions: Array<{
      categoryId: number;
      type: "income" | "expense";
      amount: string;
      currency: string;
      description: string;
      date: number;
      isFamily: boolean;
      familyGroupId: number | null;
      isWork: boolean;
      businessGroupId: number | null;
    }>
  ) => {
    saveMultiMutation.mutate({ transactions });
  };

  // Check if a transaction is "new" (created within the last 1 hour)
  const isNewTransaction = (date: number) => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    return date > oneHourAgo;
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-5">
        <img src="/logo.png" alt="Cashual" className="w-20 h-20 rounded-3xl shadow-md" />
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{t("initializing")}</p>
      </div>
    );
  }

  // Error state
  if (authState === "error" && !isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 gap-8">
        <img src="/logo.png" alt="Cashual" className="w-24 h-24 rounded-3xl shadow-lg" />
        <div className="text-center space-y-3">
          <h1 className="text-3xl font-bold tracking-tight">CA$HUAL</h1>
          <p className="text-muted-foreground text-sm">
            {t("voice_finance_tracker")}
          </p>
        </div>
        {error ? (
          <div className="flex items-start gap-3 bg-destructive/10 border border-destructive/20 rounded-2xl p-4 max-w-xs w-full">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground text-center max-w-xs">
          {t("open_via_telegram")}{" "}
          <span className="text-primary font-medium">@cashual_bot</span>
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 gap-6">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{t("authorizing")}</p>
      </div>
    );
  }

  return (
    <div className="px-5 pt-6 pb-28 space-y-7 max-w-lg mx-auto">
      {/* Header — minimal */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground font-medium">{t("greeting")}</p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {user?.telegramFirstName || user?.name || t("user_fallback")}
          </h1>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="rounded-2xl h-11 w-11 bg-card shadow-sm border-0 hover:bg-card/80"
          onClick={() => {
            setVoiceResult(null);
            setShowAddDialog(true);
          }}
        >
          <Plus className="h-5 w-5 text-primary" />
        </Button>
      </div>

      {/* Balance Card — Large, vibrant gradient, main element */}
      <div className="wallet-card wallet-card-primary">
        <div className="relative z-10">
          <p className="text-sm text-white/70 font-medium">
            {familyGroupId ? (t("family_balance") || "Family Balance") : t("total_balance")}
          </p>
          <p className="text-5xl font-bold text-white mt-3 tracking-tight">
            {summaryLoading ? (
              <span className="inline-block w-48 h-12 bg-white/20 rounded-xl animate-pulse" />
            ) : (
              <>
                {(summary?.balance ?? 0).toLocaleString("ru-RU", {
                  minimumFractionDigits: 2,
                })}
              </>
            )}
          </p>
          <p className="text-lg text-white/50 font-medium mt-1">
            {user?.preferredCurrency || "AZN"}
          </p>

          <div className="flex gap-8 mt-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center">
                <ArrowUpCircle className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-[11px] text-white/60 font-medium">{t("income")}</p>
                <p className="text-base font-bold text-white">
                  {summaryLoading
                    ? "..."
                    : (summary?.totalIncome ?? 0).toLocaleString("ru-RU", {
                        minimumFractionDigits: 2,
                      })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center">
                <ArrowDownCircle className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-[11px] text-white/60 font-medium">{t("expenses")}</p>
                <p className="text-base font-bold text-white">
                  {summaryLoading
                    ? "..."
                    : (summary?.totalExpense ?? 0).toLocaleString("ru-RU", {
                        minimumFractionDigits: 2,
                      })}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Voice Recorder — clean card */}
      <div className="tg-card text-center">
        <p className="text-xs text-muted-foreground font-medium mb-4">{t("voice_input")}</p>
        <VoiceRecorder onResult={handleVoiceResult} />
        <p className="text-[10px] text-muted-foreground mt-3">RU / AZ / EN</p>
      </div>

      {/* Receipt Scanner */}
      <Button
        variant="ghost"
        className="w-full h-14 gap-3 rounded-2xl bg-card shadow-sm hover:bg-card/80 text-foreground border-0"
        onClick={() => setShowReceiptScanner(true)}
      >
        <ScanLine className="h-5 w-5 text-primary" />
        <span className="font-medium">{t("scan_receipt")}</span>
      </Button>

      {/* Recent Transactions */}
      <div className="tg-section">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">{t("recent_records")}</h2>
          <a href="/transactions" className="text-xs text-primary font-medium">
            {t("all_records")}
          </a>
        </div>
        {txnsLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 shimmer rounded-2xl" />
            ))}
          </div>
        ) : recentTxns && recentTxns.length > 0 ? (
          <div className="tg-card p-3 space-y-1">
            {recentTxns.map((t_item) => {
              const isNew = isNewTransaction(t_item.transaction.date);
              return (
                <div
                  key={t_item.transaction.id}
                  className={`flex items-center gap-4 p-3 rounded-xl transition-all ${
                    isNew ? "new-transaction bg-primary/[0.03]" : ""
                  }`}
                >
                  <div className="w-11 h-11 rounded-2xl bg-secondary flex items-center justify-center text-lg shrink-0">
                    {t_item.categoryIcon || "📦"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate text-foreground">
                        {t_item.transaction.description || translateCategory(t_item.categoryName || "") || t("transaction_label")}
                      </p>
                      {isNew && <span className="new-badge">NEW</span>}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {translateCategory(t_item.categoryName || "")} · {new Date(t_item.transaction.date).toLocaleDateString("ru-RU")}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={`text-sm font-bold ${
                        t_item.transaction.type === "income"
                          ? "text-income"
                          : "text-expense"
                      }`}
                    >
                      {t_item.transaction.type === "income" ? "+" : "-"}
                      {parseFloat(t_item.transaction.amount).toLocaleString("ru-RU", {
                        minimumFractionDigits: 2,
                      })}
                    </p>
                    {t_item.transaction.originalCurrency &&
                      t_item.transaction.originalCurrency !== (user?.preferredCurrency || "AZN") && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {t_item.transaction.type === "income" ? "+" : "-"}
                        {parseFloat(t_item.transaction.originalAmount || "0").toLocaleString("ru-RU", {
                          minimumFractionDigits: 2,
                        })}{" "}
                        {t_item.transaction.originalCurrency}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="tg-card text-center py-12">
            <p className="text-sm text-muted-foreground">
              {t("no_records")}
            </p>
          </div>
        )}
      </div>

      {/* Receipt Scanner Dialog */}
      <ReceiptScanner
        open={showReceiptScanner}
        onOpenChange={setShowReceiptScanner}
        onSuccess={() => {
          utils.transactions.list.invalidate();
          utils.reports.summary.invalidate();
        }}
      />

      {/* Multi-Transaction Voice Review Dialog */}
      <Dialog open={showMultiVoiceDialog} onOpenChange={setShowMultiVoiceDialog}>
        <DialogContent className="max-w-md mx-auto max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("confirm_transaction") || "Confirm transactions"}</DialogTitle>
          </DialogHeader>
          <MultiTransactionReview
            transactions={multiVoiceTransactions}
            transcription={voiceTranscription}
            onSave={handleSaveMultiVoice}
            onCancel={() => {
              setShowMultiVoiceDialog(false);
              setMultiVoiceTransactions([]);
              setVoiceTranscription("");
            }}
            isSaving={saveMultiMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Add Transaction Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md mx-auto max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {voiceResult ? t("confirm_transaction") : t("new_transaction")}
            </DialogTitle>
          </DialogHeader>
          {voiceResult && (
            <div className="bg-secondary rounded-xl p-4 mb-2">
              <p className="text-xs text-muted-foreground mb-1">{t("recognized")}</p>
              <p className="text-sm italic text-foreground/80">"{voiceResult.transcription}"</p>
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
                    sourceLanguage: voiceResult.language || voiceResult.parsed.language,
                    rawTranscription: voiceResult.rawTranscription || voiceResult.transcription,
                    isFamily: voiceResult.parsed.isFamily ?? false,
                    isWork: voiceResult.parsed.isWork ?? false,
                    businessGroupId: voiceResult.parsed.businessGroupId ?? null,
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
