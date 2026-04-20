import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ArrowDownCircle, ArrowUpCircle, Loader2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

type TransactionFormProps = {
  initialData?: {
    id?: number;
    type?: "income" | "expense";
    amount?: string | number;
    currency?: string;
    categoryId?: number;
    description?: string;
    date?: number;
    isFamily?: boolean;
    familyGroupId?: number | null;
    isWork?: boolean;
    businessGroupId?: number | null;
    sourceLanguage?: string;
    rawTranscription?: string;
  };
  onSuccess?: () => void;
  onCancel?: () => void;
};

export default function TransactionForm({
  initialData,
  onSuccess,
  onCancel,
}: TransactionFormProps) {
  const isEditing = !!initialData?.id;
  const { t, translateCategory } = useLanguage();

  const [type, setType] = useState<"income" | "expense">(
    initialData?.type || "expense"
  );
  const [amount, setAmount] = useState(
    initialData?.amount?.toString() || ""
  );
  const [currency, setCurrency] = useState(initialData?.currency || "AZN");
  const [categoryId, setCategoryId] = useState<string>(
    initialData?.categoryId?.toString() || ""
  );
  const [description, setDescription] = useState(
    initialData?.description || ""
  );
  const [dateStr, setDateStr] = useState(() => {
    const d = initialData?.date ? new Date(initialData.date) : new Date();
    return d.toISOString().split("T")[0];
  });
  const [isFamily, setIsFamily] = useState(
    initialData?.isFamily !== undefined ? initialData.isFamily : false
  );
  const [familyGroupId, setFamilyGroupId] = useState<string>(
    initialData?.familyGroupId?.toString() || ""
  );
  const [isWork, setIsWork] = useState(
    initialData?.isWork !== undefined ? initialData.isWork : false
  );
  const [businessGroupId, setBusinessGroupId] = useState<string>(
    initialData?.businessGroupId?.toString() || ""
  );

  const { data: categories } = trpc.categories.list.useQuery();
  const { data: familyGroups } = trpc.family.myGroups.useQuery();
  const { data: businessGroups } = trpc.business.myGroups.useQuery();
  const { data: currentUser } = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();

  // Once familyGroups and user settings load, apply the default budget preference
  useEffect(() => {
    if (!familyGroups || familyGroups.length === 0) return;
    const firstGroup = familyGroups[0].group;
    // Only set defaults if not already set from initialData
    if (initialData?.isFamily === undefined && initialData?.isWork === undefined) {
      const defaultToFamily = currentUser?.defaultBudget === "family";
      setIsFamily(defaultToFamily);
    }
    if (!initialData?.familyGroupId && !familyGroupId) {
      setFamilyGroupId(firstGroup.id.toString());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyGroups, currentUser?.defaultBudget]);

  // When business groups load, auto-select first if isWork and none selected
  useEffect(() => {
    if (isWork && businessGroups && businessGroups.length > 0 && !businessGroupId) {
      setBusinessGroupId(businessGroups[0].id.toString());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessGroups, isWork]);

  const createMutation = trpc.transactions.create.useMutation({
    onSuccess: () => {
      utils.transactions.list.invalidate();
      utils.reports.summary.invalidate();
      utils.reports.byCategory.invalidate();
      toast.success(t("transaction_added"));
      onSuccess?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.transactions.update.useMutation({
    onSuccess: () => {
      utils.transactions.list.invalidate();
      utils.reports.summary.invalidate();
      utils.reports.byCategory.invalidate();
      toast.success(t("transaction_updated"));
      onSuccess?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const filteredCategories = useMemo(() => {
    if (!categories) return [];
    return categories.filter(
      (c) => c.type === "both" || c.type === type
    );
  }, [categories, type]);

  const isLoading = createMutation.isPending || updateMutation.isPending;

  // Budget mode: "personal" | "family" | "work"
  const budgetMode = isWork ? "work" : isFamily ? "family" : "personal";
  const setBudgetMode = (mode: "personal" | "family" | "work") => {
    setIsFamily(mode === "family");
    setIsWork(mode === "work");
  };

  const handleSubmit = () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error(t("enter_amount"));
      return;
    }
    if (!categoryId) {
      toast.error(t("select_category_error"));
      return;
    }

    const dateTimestamp = new Date(dateStr).getTime();

    if (isEditing && initialData?.id) {
      updateMutation.mutate({
        id: initialData.id,
        type,
        amount,
        currency,
        categoryId: parseInt(categoryId),
        description,
        date: dateTimestamp,
        isFamily,
        familyGroupId: isFamily && familyGroupId ? parseInt(familyGroupId) : null,
        isWork,
        businessGroupId: isWork && businessGroupId ? parseInt(businessGroupId) : null,
      });
    } else {
      createMutation.mutate({
        type,
        amount,
        currency,
        categoryId: parseInt(categoryId),
        description,
        date: dateTimestamp,
        isFamily,
        familyGroupId: isFamily && familyGroupId ? parseInt(familyGroupId) : null,
        isWork,
        businessGroupId: isWork && businessGroupId ? parseInt(businessGroupId) : null,
        sourceLanguage: initialData?.sourceLanguage,
        rawTranscription: initialData?.rawTranscription,
      });
    }
  };

  const hasFamilyGroups = familyGroups && familyGroups.length > 0;
  const hasBusinessGroups = businessGroups && businessGroups.length > 0;

  return (
    <div className="space-y-4">
      {/* Type toggle */}
      <div className="flex gap-2">
        <Button
          variant={type === "expense" ? "default" : "outline"}
          className={`flex-1 ${type === "expense" ? "bg-expense text-white" : ""}`}
          onClick={() => setType("expense")}
        >
          <ArrowDownCircle className="h-4 w-4 mr-2" />
          {t("expense")}
        </Button>
        <Button
          variant={type === "income" ? "default" : "outline"}
          className={`flex-1 ${type === "income" ? "bg-income text-white" : ""}`}
          onClick={() => setType("income")}
        >
          <ArrowUpCircle className="h-4 w-4 mr-2" />
          {t("income_btn")}
        </Button>
      </div>

      {/* Amount + Currency */}
      <div className="flex gap-2">
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground mb-1">{t("amount")}</Label>
          <Input
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="text-lg font-semibold h-12"
            inputMode="decimal"
          />
        </div>
        <div className="w-24">
          <Label className="text-xs text-muted-foreground mb-1">{t("currency")}</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="h-12">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AZN">AZN</SelectItem>
              <SelectItem value="RUB">RUB</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="EUR">EUR</SelectItem>
              <SelectItem value="TRY">TRY</SelectItem>
              <SelectItem value="GEL">GEL</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Category */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1">{t("category")}</Label>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="h-12">
            <SelectValue placeholder={t("select_category")} />
          </SelectTrigger>
          <SelectContent>
            {filteredCategories.map((c) => (
              <SelectItem key={c.id} value={c.id.toString()}>
                <span className="flex items-center gap-2">
                  <span>{c.icon}</span>
                  <span>{translateCategory(c.name)}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Description */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1">{t("description")}</Label>
        <Input
          placeholder={t("description_placeholder")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="h-12"
        />
      </div>

      {/* Date */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1">{t("date")}</Label>
        <Input
          type="date"
          value={dateStr}
          onChange={(e) => setDateStr(e.target.value)}
          className="h-12"
        />
      </div>

      {/* Budget toggle: Personal / Family / Work */}
      {(hasFamilyGroups || hasBusinessGroups) && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant={budgetMode === "personal" ? "default" : "outline"}
              size="sm"
              onClick={() => setBudgetMode("personal")}
            >
              {t("personal")}
            </Button>
            {hasFamilyGroups && (
              <Button
                variant={budgetMode === "family" ? "default" : "outline"}
                size="sm"
                onClick={() => setBudgetMode("family")}
              >
                {t("family")}
              </Button>
            )}
            {hasBusinessGroups && (
              <Button
                variant={budgetMode === "work" ? "default" : "outline"}
                size="sm"
                className={budgetMode === "work" ? "bg-blue-600 text-white hover:bg-blue-700" : ""}
                onClick={() => setBudgetMode("work")}
              >
                💼 {t("work")}
              </Button>
            )}
          </div>

          {/* Family group selector */}
          {budgetMode === "family" && hasFamilyGroups && (
            <Select value={familyGroupId} onValueChange={setFamilyGroupId}>
              <SelectTrigger className="h-12">
                <SelectValue placeholder={t("select_group")} />
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

          {/* Business group selector */}
          {budgetMode === "work" && hasBusinessGroups && (
            <Select value={businessGroupId} onValueChange={setBusinessGroupId}>
              <SelectTrigger className="h-12">
                <SelectValue placeholder={t("select_business_group")} />
              </SelectTrigger>
              <SelectContent>
                {businessGroups.map((bg) => (
                  <SelectItem key={bg.id} value={bg.id.toString()}>
                    <span className="flex items-center gap-2">
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

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        {onCancel && (
          <Button variant="outline" className="flex-1 h-12" onClick={onCancel}>
            {t("cancel")}
          </Button>
        )}
        <Button
          className="flex-1 h-12"
          onClick={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isEditing ? (
            t("save")
          ) : (
            t("add")
          )}
        </Button>
      </div>
    </div>
  );
}
