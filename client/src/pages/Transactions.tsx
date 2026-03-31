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
  ArrowUpCircle,
  ArrowDownCircle,
} from "lucide-react";
import TransactionForm from "@/components/TransactionForm";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
export default function Transactions() {
  const { isAuthenticated } = useAuth();
  const { translateCategory } = useLanguage();
  const [editingTxn, setEditingTxn] = useState<any>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string>("all");

  const { data: txns, isLoading } = trpc.transactions.list.useQuery(
    {
      type: filterType !== "all" ? (filterType as "income" | "expense") : undefined,
      limit: 200,
    },
    { enabled: isAuthenticated }
  );

  const utils = trpc.useUtils();
  const deleteMutation = trpc.transactions.delete.useMutation({
    onSuccess: () => {
      utils.transactions.list.invalidate();
      utils.reports.summary.invalidate();
      utils.reports.byCategory.invalidate();
      toast.success("Транзакция удалена");
      setDeletingId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Войдите для просмотра</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Транзакции</h1>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-32 h-9">
            <Filter className="h-3.5 w-3.5 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="expense">Расходы</SelectItem>
            <SelectItem value="income">Доходы</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Transaction List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : txns && txns.length > 0 ? (
        <div className="space-y-2">
          {txns.map((t) => (
            <div
              key={t.transaction.id}
              className="tg-card flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-lg shrink-0">
                {t.categoryIcon || "📦"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium truncate">
                    {t.transaction.description || translateCategory(t.categoryName || "Другое") || "Транзакция"}
                  </p>
                  {t.transaction.isFamily && (
                    <span className="text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full shrink-0">
                      Семья
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {translateCategory(t.categoryName || "")} ·{" "}
                  {new Date(t.transaction.date).toLocaleDateString("ru-RU")}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <p
                  className={`text-sm font-semibold mr-1 ${
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() =>
                    setEditingTxn({
                      id: t.transaction.id,
                      type: t.transaction.type,
                      amount: t.transaction.amount,
                      currency: t.transaction.currency,
                      categoryId: t.transaction.categoryId,
                      description: t.transaction.description,
                      date: t.transaction.date,
                      isFamily: t.transaction.isFamily,
                      familyGroupId: t.transaction.familyGroupId,
                    })
                  }
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => setDeletingId(t.transaction.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="tg-card text-center py-12">
          <p className="text-muted-foreground">Нет транзакций</p>
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editingTxn} onOpenChange={() => setEditingTxn(null)}>
        <DialogContent className="max-w-md mx-auto max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Редактировать</DialogTitle>
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
            <AlertDialogTitle>Удалить транзакцию?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (deletingId) deleteMutation.mutate({ id: deletingId });
              }}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Удалить"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
