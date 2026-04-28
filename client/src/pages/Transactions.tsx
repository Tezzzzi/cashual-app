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
    <div className="px-4 pt-4 space-y-4 max-w-lg mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t("transactions_title")}</h1>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-32 h-9">
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
        <div className="tg-card space-y-2">
          <div className="flex gap-1.5 flex-wrap">
            <Button
              variant={budgetFilter === "all" ? "default" : "outline"}
              size="sm"
              className="text-xs"
              onClick={() => setBudgetFilter("all")}
            >
              {t("all")}
            </Button>
            <Button
              variant={budgetFilter === "personal" ? "default" : "outline"}
              size="sm"
              className="text-xs"
              onClick={() => setBudgetFilter("personal")}
            >
              {t("personal")}
            </Button>
            {hasFamily && (
              <Button
                variant={budgetFilter === "family" ? "default" : "outline"}
                size="sm"
                className="text-xs"
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
                className={`text-xs ${budgetFilter === "work" ? "bg-blue-600 text-white hover:bg-blue-700" : ""}`}
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
                    className={`flex-1 text-xs ${scope === s.key ? "bg-primary text-primary-foreground" : ""}`}
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

      {/* Transaction List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : txns && txns.length > 0 ? (
        <div className="space-y-2">
          {txns.map((t_item) => (
            <div
              key={t_item.transaction.id}
              className="tg-card flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-lg shrink-0">
                {t_item.categoryIcon || "📦"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium truncate">
                    {t_item.transaction.description || translateCategory(t_item.categoryName || "Другое") || t("transactions_title")}
                  </p>
                  {t_item.transaction.isFamily && (
                    <span className="text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full shrink-0">
                      {t("family_badge")}
                    </span>
                  )}
                  {t_item.transaction.isWork && (
                    <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full shrink-0">
                      💼 {t("work_badge")}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {translateCategory(t_item.categoryName || "")}
                  {t_item.userName && scope !== "mine" && (
                    <span className="text-primary/80"> · {t_item.userName}</span>
                  )}
                  {" · "}
                  {new Date(t_item.transaction.date).toLocaleDateString("ru-RU")}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <div className="mr-1">
                  {formatAmount(t_item.transaction)}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
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
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => setDeletingId(t_item.transaction.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="tg-card text-center py-12">
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
