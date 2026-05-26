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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Pencil,
  Trash2,
  Filter,
  Users,
  Briefcase,
} from "lucide-react";
import TransactionForm from "@/components/TransactionForm";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";

type Scope = "mine" | "partner" | "all";
type BudgetFilter = "all" | "personal" | "family" | "work";

export default function Transactions() {
  const { isAuthenticated } = useAuth();
  const { t, translateCategory } = useLanguage();
  const [editingTxn, setEditingTxn] = useState<any>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [scope, setScope] = useState<Scope>("mine");
  const [budgetFilter, setBudgetFilter] = useState<BudgetFilter>("all");
  const [businessGroupFilter, setBusinessGroupFilter] = useState<string>("all");

  // Fetch family groups to determine if user has a family
  const { data: familyGroups } = trpc.family.myGroups.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const hasFamily = (familyGroups?.length ?? 0) > 0;
  const familyGroupId = hasFamily ? familyGroups![0].group.id : undefined;

  // Fetch business groups
  const { data: businessGroups } = trpc.business.myGroups.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const hasBusiness = (businessGroups?.length ?? 0) > 0;

  // Fetch current user for preferredCurrency
  const { data: currentUser } = trpc.auth.me.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const userCurrency = currentUser?.preferredCurrency || "AZN";

  // Build query params
  const listParams = useMemo(() => {
    const base: Record<string, any> = {
      type: filterType !== "all" ? filterType : undefined,
      limit: 200,
    };

    if (budgetFilter === "work") {
      base.isWork = true;
      if (businessGroupFilter !== "all") {
        base.businessGroupId = parseInt(businessGroupFilter);
      }
    } else if (budgetFilter === "family" && hasFamily) {
      base.isFamily = true;
      if (scope !== "mine") {
        return { ...base, familyGroupId, scope };
      }
    } else if (budgetFilter === "personal") {
      base.isFamily = false;
      base.isWork = false;
    } else if (budgetFilter === "all" && hasFamily && scope !== "mine") {
      return { ...base, familyGroupId, scope };
    }

    return base;
  }, [filterType, hasFamily, scope, familyGroupId, budgetFilter, businessGroupFilter]);

  const { data: txns, isLoading } = trpc.transactions.list.useQuery(
    listParams,
    { enabled: isAuthenticated }
  );

  const utils = trpc.useUtils();
  const deleteMutation = trpc.transactions.delete.useMutation({
    onSuccess: () => {
      utils.transactions.list.invalidate();
      utils.reports.summary.invalidate();
      utils.reports.byCategory.invalidate();
      toast.success(t("transaction_deleted"));
      setDeletingId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  // Check if a transaction is "new" (created within the last 1 hour)
  const isNewTransaction = (date: number) => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    return date > oneHourAgo;
  };

  // Group transactions by date for date separators — MUST be before any early return (hooks rules)
  const groupedTransactions = useMemo(() => {
    if (!txns) return [];
    const groups: { date: string; label: string; dayTotal: number; items: typeof txns }[] = [];
    let currentDate = "";

    for (const t_item of txns) {
      const dateStr = new Date(t_item.transaction.date).toLocaleDateString("ru-RU");
      if (dateStr !== currentDate) {
        currentDate = dateStr;
        // Format a friendly label
        const txDate = new Date(t_item.transaction.date);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        let label: string;
        if (txDate.toDateString() === today.toDateString()) {
          label = t("today") || "Сегодня";
        } else if (txDate.toDateString() === yesterday.toDateString()) {
          label = t("yesterday") || "Вчера";
        } else {
          label = txDate.toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "long",
            year: txDate.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
          });
        }
        groups.push({ date: dateStr, label, dayTotal: 0, items: [] });
      }
      groups[groups.length - 1].items.push(t_item);
      // Sum up expenses for the day
      if (t_item.transaction.type === "expense") {
        groups[groups.length - 1].dayTotal += Number(t_item.transaction.amount) || 0;
      }
    }
    return groups;
  }, [txns, t]);

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">{t("login_to_view")}</p>
      </div>
    );
  }

  const scopes: { key: Scope; label: string }[] = [
    { key: "mine", label: t("scope_personal") },
    { key: "partner", label: t("scope_partner") },
    { key: "all", label: t("scope_all") },
  ];

  // Helper: format amount with dual currency display
  const formatAmount = (txn: any) => {
    const mainAmount = parseFloat(txn.amount).toLocaleString("ru-RU", {
      minimumFractionDigits: 2,
    });
    const sign = txn.type === "income" ? "+" : "-";
    const origAmount = txn.originalAmount ? parseFloat(txn.originalAmount) : null;
    const origCurrency = txn.originalCurrency;

    // Show dual display if original currency differs from user's default
    if (origAmount && origCurrency && origCurrency.toUpperCase() !== userCurrency.toUpperCase()) {
      const origFormatted = origAmount.toLocaleString("ru-RU", { minimumFractionDigits: 2 });
      return (
        <div className="text-right">
          <p className={`text-sm font-semibold ${txn.type === "income" ? "text-income" : "text-expense"}`}>
            {sign}{mainAmount} {userCurrency}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {sign}{origFormatted} {origCurrency}
          </p>
        </div>
      );
    }

    return (
      <p className={`text-sm font-semibold ${txn.type === "income" ? "text-income" : "text-expense"}`}>
        {sign}{mainAmount}
      </p>
    );
  };

  return (
    <div className="px-5 pt-6 space-y-6 max-w-lg mx-auto pb-28">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("transactions_title")}</h1>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-32 h-9 bg-card shadow-sm border-0">
            <Filter className="h-3.5 w-3.5 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("all")}</SelectItem>
            <SelectItem value="expense">{t("filter_expense")}</SelectItem>
            <SelectItem value="income">{t("filter_income")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Budget filter tabs */}
      {(hasFamily || hasBusiness) && (
        <div className="tg-card space-y-3">
          <div className="flex gap-1.5 flex-wrap">
            <Button
              variant={budgetFilter === "all" ? "default" : "outline"}
              size="sm"
              className="text-xs rounded-xl"
              onClick={() => setBudgetFilter("all")}
            >
              {t("all")}
            </Button>
            <Button
              variant={budgetFilter === "personal" ? "default" : "outline"}
              size="sm"
              className="text-xs rounded-xl"
              onClick={() => setBudgetFilter("personal")}
            >
              {t("personal")}
            </Button>
            {hasFamily && (
              <Button
                variant={budgetFilter === "family" ? "default" : "outline"}
                size="sm"
                className="text-xs rounded-xl"
                onClick={() => setBudgetFilter("family")}
              >
                <Users className="h-3 w-3 mr-1" />
                {t("family")}
              </Button>
            )}
            {hasBusiness && (
              <Button
                variant={budgetFilter === "work" ? "default" : "outline"}
                size="sm"
                className={`text-xs rounded-xl ${budgetFilter === "work" ? "bg-blue-600 text-white hover:bg-blue-700" : ""}`}
                onClick={() => setBudgetFilter("work")}
              >
                <Briefcase className="h-3 w-3 mr-1" />
                {t("work")}
              </Button>
            )}
          </div>

          {/* Business group sub-filter */}
          {budgetFilter === "work" && hasBusiness && businessGroups && businessGroups.length > 1 && (
            <Select value={businessGroupFilter} onValueChange={setBusinessGroupFilter}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder={t("all")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("all")}</SelectItem>
                {businessGroups.map((bg) => (
                  <SelectItem key={bg.id} value={bg.id.toString()}>
                    {bg.icon} {bg.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Family scope selector */}
          {(budgetFilter === "family" || budgetFilter === "all") && hasFamily && (
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary shrink-0" />
              <div className="flex gap-1.5 flex-1">
                {scopes.map((s) => (
                  <Button
                    key={s.key}
                    variant={scope === s.key ? "default" : "outline"}
                    size="sm"
                    className={`flex-1 text-xs rounded-xl ${scope === s.key ? "bg-primary text-primary-foreground" : ""}`}
                    onClick={() => setScope(s.key)}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Transaction List with Date Separators */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : groupedTransactions.length > 0 ? (
        <div className="space-y-2">
          {groupedTransactions.map((group) => (
            <div key={group.date}>
              {/* Date Separator */}
              <div className="date-separator">
                <span>{group.label}</span>
                {group.dayTotal > 0 && (
                  <span className="text-xs font-medium text-muted-foreground">
                    −€{group.dayTotal.toFixed(2)}
                  </span>
                )}
              </div>

              {/* Transactions for this date in a single card */}
              <div className="tg-card p-3 space-y-0.5">
                {group.items.map((t_item) => {
                  const isNew = isNewTransaction(t_item.transaction.date);
                  return (
                    <div
                      key={t_item.transaction.id}
                      className={`flex items-center gap-3 p-3 rounded-xl transition-all ${
                        isNew ? "new-transaction bg-primary/[0.04]" : ""
                      }`}
                    >
                      <div className="w-11 h-11 rounded-2xl bg-secondary flex items-center justify-center text-lg shrink-0">
                        {t_item.categoryIcon || "📦"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate text-foreground">
                            {t_item.transaction.description || translateCategory(t_item.categoryName || "Other") || t("transactions_title")}
                          </p>
                          {isNew && <span className="new-badge">NEW</span>}
                          {t_item.transaction.isFamily && (
                            <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full shrink-0 font-medium">
                              {t("family_badge")}
                            </span>
                          )}
                          {t_item.transaction.isWork && (
                            <span className="text-[9px] bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded-full shrink-0 font-medium">
                              {t("work_badge")}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {translateCategory(t_item.categoryName || "")}
                          {t_item.userName && scope !== "mine" && (
                            <span className="text-primary/80"> · {t_item.userName}</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <div className="mr-1">
                          {formatAmount(t_item.transaction)}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-xl hover:bg-secondary"
                          onClick={() =>
                            setEditingTxn({
                              id: t_item.transaction.id,
                              type: t_item.transaction.type,
                              amount: t_item.transaction.amount,
                              currency: t_item.transaction.currency,
                              categoryId: t_item.transaction.categoryId,
                              description: t_item.transaction.description,
                              date: t_item.transaction.date,
                              isFamily: t_item.transaction.isFamily,
                              familyGroupId: t_item.transaction.familyGroupId,
                              isWork: t_item.transaction.isWork,
                              businessGroupId: t_item.transaction.businessGroupId,
                              originalAmount: t_item.transaction.originalAmount,
                              originalCurrency: t_item.transaction.originalCurrency,
                            })
                          }
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-xl hover:bg-destructive/10"
                          onClick={() => setDeletingId(t_item.transaction.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="tg-card text-center py-14">
          <p className="text-muted-foreground">{t("no_transactions")}</p>
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editingTxn} onOpenChange={() => setEditingTxn(null)}>
        <DialogContent className="max-w-md mx-auto max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("edit")}</DialogTitle>
          </DialogHeader>
          {editingTxn && (
            <TransactionForm
              initialData={editingTxn}
              onSuccess={() => setEditingTxn(null)}
              onCancel={() => setEditingTxn(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingId}
        onOpenChange={() => setDeletingId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirm_delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirm_delete_desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (deletingId) deleteMutation.mutate({ id: deletingId });
              }}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("delete_confirm")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
