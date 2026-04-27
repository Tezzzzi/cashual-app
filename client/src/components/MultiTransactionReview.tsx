import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Save,
  Trash2,
  Briefcase,
  Users,
  User,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/_core/hooks/useAuth";

export type ReviewTransaction = {
  type: "income" | "expense";
  amount: number;
  currency: string;
  categoryId?: number;
  categoryName: string;
  categoryIcon: string;
  description: string;
  date: number;
  confidence?: "high" | "medium" | "low";
  // Budget fields (from voice AI or defaults)
  budgetContext?: "personal" | "family" | "work";
  isFamily?: boolean;
  isWork?: boolean;
  businessGroupId?: number | null;
  detectedBusinessGroupName?: string | null;
};

type BudgetSelection = {
  budgetMode: "personal" | "family" | "work";
  familyGroupId: number | null;
  businessGroupId: number | null;
};

type DuplicateInfo = {
  index: number;
  existingDescription: string;
  existingAmount: string;
  existingDate: number;
};

type MultiTransactionReviewProps = {
  transactions: ReviewTransaction[];
  imageType?: "bank_screenshot" | "store_receipt" | "other";
  previewUrl?: string | null;
  transcription?: string | null;
  imageCount?: number;
  duplicateIndices?: Set<number>;
  duplicateInfos?: DuplicateInfo[];
  onSave: (
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
  ) => void;
  onCancel: () => void;
  isSaving?: boolean;
};

export default function MultiTransactionReview({
  transactions,
  imageType,
  previewUrl,
  transcription,
  imageCount,
  duplicateIndices = new Set(),
  duplicateInfos = [],
  onSave,
  onCancel,
  isSaving = false,
}: MultiTransactionReviewProps) {
  const { t, translateCategory } = useLanguage();
  const { user } = useAuth();
  const { data: familyGroups } = trpc.family.myGroups.useQuery();
  const { data: businessGroups } = trpc.business.myGroups.useQuery();

  // Initialize selected indices: all selected EXCEPT duplicates
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    new Set(transactions.map((_, i) => i).filter((i) => !duplicateIndices.has(i)))
  );

  // Update selection when duplicateIndices changes (async load)
  useEffect(() => {
    if (duplicateIndices.size > 0) {
      setSelectedIndices((prev) => {
        const next = new Set(prev);
        duplicateIndices.forEach((i) => next.delete(i));
        return next;
      });
    }
  }, [duplicateIndices]);

  // Per-transaction budget selections
  const [budgetSelections, setBudgetSelections] = useState<Map<number, BudgetSelection>>(
    new Map()
  );

  // Bulk budget state
  const [bulkBudgetMode, setBulkBudgetMode] = useState<"personal" | "family" | "work">("personal");
  const [bulkFamilyGroupId, setBulkFamilyGroupId] = useState<string>("");
  const [bulkBusinessGroupId, setBulkBusinessGroupId] = useState<string>("");

  const hasFamilyGroups = familyGroups && familyGroups.length > 0;
  const hasBusinessGroups = businessGroups && businessGroups.length > 0;

  // Initialize per-transaction budgets from AI-detected values
  useEffect(() => {
    const initial = new Map<number, BudgetSelection>();
    const defaultBudget = (user as any)?.defaultBudget || "personal";
    const defaultFamilyGroupId = familyGroups?.[0]?.group?.id ?? null;
    const defaultBusinessGroupId = businessGroups?.[0]?.id ?? null;

    transactions.forEach((tx, i) => {
      let budgetMode: "personal" | "family" | "work" = defaultBudget;
      let fgId: number | null = null;
      let bgId: number | null = null;

      if (tx.isWork || tx.budgetContext === "work") {
        budgetMode = "work";
        bgId = tx.businessGroupId ?? defaultBusinessGroupId;
      } else if (tx.isFamily || tx.budgetContext === "family") {
        budgetMode = "family";
        fgId = defaultFamilyGroupId;
      }

      initial.set(i, { budgetMode, familyGroupId: fgId, businessGroupId: bgId });
    });

    setBudgetSelections(initial);

    const modes = Array.from(initial.values()).map((b) => b.budgetMode);
    const modeCounts = { personal: 0, family: 0, work: 0 };
    modes.forEach((m) => modeCounts[m]++);
    const topMode = (Object.entries(modeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "personal") as "personal" | "family" | "work";
    setBulkBudgetMode(topMode);
    if (topMode === "family" && defaultFamilyGroupId) {
      setBulkFamilyGroupId(defaultFamilyGroupId.toString());
    }
    if (topMode === "work" && defaultBusinessGroupId) {
      setBulkBusinessGroupId(defaultBusinessGroupId.toString());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, familyGroups, businessGroups, user]);

  const toggleSelect = (idx: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const getBudget = (idx: number): BudgetSelection => {
    return budgetSelections.get(idx) || { budgetMode: "personal", familyGroupId: null, businessGroupId: null };
  };

  const updateBudget = (idx: number, update: Partial<BudgetSelection>) => {
    setBudgetSelections((prev) => {
      const next = new Map(prev);
      const current = next.get(idx) || { budgetMode: "personal" as const, familyGroupId: null, businessGroupId: null };
      next.set(idx, { ...current, ...update });
      return next;
    });
  };

  const applyBulkBudget = () => {
    setBudgetSelections((prev) => {
      const next = new Map(prev);
      selectedIndices.forEach((idx) => {
        next.set(idx, {
          budgetMode: bulkBudgetMode,
          familyGroupId: bulkBudgetMode === "family" && bulkFamilyGroupId ? parseInt(bulkFamilyGroupId) : null,
          businessGroupId: bulkBudgetMode === "work" && bulkBusinessGroupId ? parseInt(bulkBusinessGroupId) : null,
        });
      });
      return next;
    });
    toast.success(t("budget_applied_to_all") || `Budget applied to ${selectedIndices.size} transactions`);
  };

  const handleSave = () => {
    const toSave = transactions
      .map((tx, i) => {
        if (!selectedIndices.has(i)) return null;
        const budget = getBudget(i);
        return {
          categoryId: tx.categoryId ?? 1,
          type: tx.type,
          amount: tx.amount.toFixed(2),
          currency: tx.currency,
          description: tx.description,
          date: tx.date,
          isFamily: budget.budgetMode === "family",
          familyGroupId: budget.budgetMode === "family" ? budget.familyGroupId : null,
          isWork: budget.budgetMode === "work",
          businessGroupId: budget.budgetMode === "work" ? budget.businessGroupId : null,
        };
      })
      .filter(Boolean) as Array<{
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
      }>;

    if (toSave.length === 0) {
      toast.error(t("no_transactions_selected") || "No transactions selected");
      return;
    }

    onSave(toSave);
  };

  const confidenceColor: Record<string, string> = {
    high: "text-green-400",
    medium: "text-yellow-400",
    low: "text-red-400",
  };

  const budgetBadge = (budget: BudgetSelection) => {
    if (budget.budgetMode === "work") {
      const bg = businessGroups?.find((g) => g.id === budget.businessGroupId);
      return (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-blue-500/20 text-blue-400">
          <Briefcase className="h-2.5 w-2.5" />
          {bg?.name || t("work")}
        </span>
      );
    }
    if (budget.budgetMode === "family") {
      return (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-purple-500/20 text-purple-400">
          <Users className="h-2.5 w-2.5" />
          {t("family")}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-gray-500/20 text-gray-400">
        <User className="h-2.5 w-2.5" />
        {t("personal")}
      </span>
    );
  };

  const cycleBudget = (idx: number) => {
    const current = getBudget(idx);
    const modes: Array<"personal" | "family" | "work"> = ["personal"];
    if (hasFamilyGroups) modes.push("family");
    if (hasBusinessGroups) modes.push("work");

    const currentIdx = modes.indexOf(current.budgetMode);
    const nextMode = modes[(currentIdx + 1) % modes.length];

    const defaultFamilyGroupId = familyGroups?.[0]?.group?.id ?? null;
    const defaultBusinessGroupId = businessGroups?.[0]?.id ?? null;

    updateBudget(idx, {
      budgetMode: nextMode,
      familyGroupId: nextMode === "family" ? defaultFamilyGroupId : null,
      businessGroupId: nextMode === "work" ? defaultBusinessGroupId : null,
    });
  };

  const imageTypeLabel: Record<string, string> = {
    bank_screenshot: "🏦 Bank/Wallet screenshot",
    store_receipt: "🧾 Store receipt",
    other: "📄 Document",
  };

  const dupeCount = duplicateIndices.size;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex gap-3 items-start">
        {previewUrl && (
          <div className="w-14 h-14 rounded-lg overflow-hidden border border-border flex-shrink-0">
            <img src={previewUrl} alt="Receipt" className="w-full h-full object-cover" />
          </div>
        )}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="h-4 w-4 text-green-400" />
            <span className="text-sm font-medium">
              {transcription ? (t("voice_recognized") || "Voice recognized") : (t("receipt_recognized") || "Recognized")}
            </span>
          </div>
          {imageType && (
            <p className="text-xs text-muted-foreground">{imageTypeLabel[imageType]}</p>
          )}
          {imageCount && imageCount > 1 && (
            <p className="text-xs text-muted-foreground">
              {imageCount} {t("images_processed") || "images processed"}
            </p>
          )}
          {transcription && (
            <p className="text-xs text-muted-foreground italic truncate">"{transcription}"</p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">
            {transactions.length} {t("transactions_found") || "transactions found"}
            {" · "}{selectedIndices.size} {t("selected") || "selected"}
          </p>
        </div>
      </div>

      {/* Duplicate warning banner */}
      {dupeCount > 0 && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-orange-500/10 border border-orange-500/20">
          <Copy className="h-4 w-4 text-orange-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-orange-400">
              {dupeCount} {t("potential_duplicates") || "potential duplicate(s) found"}
            </p>
            <p className="text-[10px] text-orange-400/70 mt-0.5">
              {t("duplicates_unchecked") || "Duplicates are unchecked by default. Check them if you want to save anyway."}
            </p>
          </div>
        </div>
      )}

      {/* Bulk budget selector */}
      {(hasFamilyGroups || hasBusinessGroups) && (
        <div className="p-2.5 rounded-lg border border-border bg-muted/30 space-y-2">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
            {t("bulk_budget") || "Budget for all"}
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              variant={bulkBudgetMode === "personal" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setBulkBudgetMode("personal")}
            >
              <User className="h-3 w-3 mr-1" />
              {t("personal")}
            </Button>
            {hasFamilyGroups && (
              <Button
                variant={bulkBudgetMode === "family" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => setBulkBudgetMode("family")}
              >
                <Users className="h-3 w-3 mr-1" />
                {t("family")}
              </Button>
            )}
            {hasBusinessGroups && (
              <Button
                variant={bulkBudgetMode === "work" ? "default" : "outline"}
                size="sm"
                className={`h-7 text-xs px-2 ${bulkBudgetMode === "work" ? "bg-blue-600 text-white hover:bg-blue-700" : ""}`}
                onClick={() => setBulkBudgetMode("work")}
              >
                <Briefcase className="h-3 w-3 mr-1" />
                {t("work")}
              </Button>
            )}

            {bulkBudgetMode === "work" && hasBusinessGroups && (
              <Select value={bulkBusinessGroupId} onValueChange={setBulkBusinessGroupId}>
                <SelectTrigger className="h-7 text-xs w-auto min-w-[100px]">
                  <SelectValue placeholder={t("select_business_group") || "Company"} />
                </SelectTrigger>
                <SelectContent>
                  {businessGroups.map((bg) => (
                    <SelectItem key={bg.id} value={bg.id.toString()}>
                      <span className="flex items-center gap-1">
                        <span>{bg.icon}</span>
                        <span>{bg.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {bulkBudgetMode === "family" && hasFamilyGroups && (
              <Select value={bulkFamilyGroupId} onValueChange={setBulkFamilyGroupId}>
                <SelectTrigger className="h-7 text-xs w-auto min-w-[100px]">
                  <SelectValue placeholder={t("select_group") || "Group"} />
                </SelectTrigger>
                <SelectContent>
                  {familyGroups.map((fg) => (
                    <SelectItem key={fg.group.id} value={fg.group.id.toString()}>
                      {fg.group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2 ml-auto"
              onClick={applyBulkBudget}
            >
              {t("apply_to_all") || "Apply to all"}
            </Button>
          </div>
        </div>
      )}

      {/* Transaction list */}
      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {transactions.map((tx, i) => {
          const isSelected = selectedIndices.has(i);
          const isDuplicate = duplicateIndices.has(i);
          const dupeInfo = duplicateInfos.find((d) => d.index === i);
          const budget = getBudget(i);
          return (
            <div
              key={i}
              className={`p-2.5 rounded-lg border transition-all ${
                isDuplicate && !isSelected
                  ? "border-orange-500/30 bg-orange-500/5 opacity-60"
                  : isSelected
                  ? "border-primary/50 bg-primary/5"
                  : "border-border bg-muted/30 opacity-50"
              }`}
            >
              <div className="flex items-center gap-2.5">
                {/* Checkbox */}
                <div
                  onClick={() => toggleSelect(i)}
                  className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center cursor-pointer ${
                    isSelected ? "border-primary bg-primary" : isDuplicate ? "border-orange-500" : "border-muted-foreground"
                  }`}
                >
                  {isSelected && <span className="text-[8px] text-primary-foreground font-bold">✓</span>}
                </div>

                {/* Category icon */}
                <span className="text-base flex-shrink-0">{tx.categoryIcon}</span>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{tx.description}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] text-muted-foreground">
                      {translateCategory(tx.categoryName)} · {new Date(tx.date).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Amount */}
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-semibold ${tx.type === "income" ? "text-green-400" : "text-red-400"}`}>
                    {tx.type === "income" ? "+" : "-"}{tx.amount.toFixed(2)} {tx.currency}
                  </p>
                  {tx.confidence && (
                    <span className={`text-[9px] ${confidenceColor[tx.confidence]}`}>{tx.confidence}</span>
                  )}
                </div>
              </div>

              {/* Duplicate warning for this item */}
              {isDuplicate && dupeInfo && (
                <div className="mt-1.5 ml-6 flex items-center gap-1.5 px-2 py-1 rounded bg-orange-500/10">
                  <AlertTriangle className="h-3 w-3 text-orange-400 flex-shrink-0" />
                  <span className="text-[10px] text-orange-400">
                    {t("duplicate_exists") || "Possible duplicate"}: {dupeInfo.existingDescription} · {parseFloat(dupeInfo.existingAmount).toFixed(2)} · {new Date(dupeInfo.existingDate).toLocaleDateString()}
                  </span>
                </div>
              )}

              {/* Budget badge row — tap to cycle */}
              {isSelected && (hasFamilyGroups || hasBusinessGroups) && (
                <div className="mt-1.5 flex items-center gap-1.5 ml-6">
                  <span
                    className="cursor-pointer"
                    onClick={() => cycleBudget(i)}
                    title={t("tap_to_change_budget") || "Tap to change budget"}
                  >
                    {budgetBadge(budget)}
                  </span>

                  {budget.budgetMode === "work" && hasBusinessGroups && (
                    <Select
                      value={budget.businessGroupId?.toString() || ""}
                      onValueChange={(val) => updateBudget(i, { businessGroupId: parseInt(val) })}
                    >
                      <SelectTrigger className="h-5 text-[10px] w-auto min-w-[80px] border-blue-500/30 px-1.5">
                        <SelectValue placeholder="Company" />
                      </SelectTrigger>
                      <SelectContent>
                        {businessGroups.map((bg) => (
                          <SelectItem key={bg.id} value={bg.id.toString()}>
                            <span className="flex items-center gap-1">
                              <span>{bg.icon}</span>
                              <span>{bg.name}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Low confidence warning */}
      {transactions.some((tx) => tx.confidence === "low") && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <AlertCircle className="h-3.5 w-3.5 text-yellow-400 flex-shrink-0" />
          <span className="text-[10px] text-yellow-400">{t("review_carefully") || "Review carefully — some items have low confidence"}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        <Button variant="outline" className="flex-1 h-11 gap-2" onClick={onCancel}>
          <Trash2 className="h-4 w-4" />
          {t("cancel")}
        </Button>
        <Button
          className="flex-1 h-11 gap-2"
          onClick={handleSave}
          disabled={isSaving || selectedIndices.size === 0}
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {t("save")} ({selectedIndices.size})
        </Button>
      </div>
    </div>
  );
}
