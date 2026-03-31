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

  const { data: categories } = trpc.categories.list.useQuery();
  const { data: familyGroups } = trpc.family.myGroups.useQuery();
  const utils = trpc.useUtils();

  // Once familyGroups loads, default to family budget if user has a group
  // and no explicit initialData override was provided
  useEffect(() => {
    if (!familyGroups || familyGroups.length === 0) return;
    const firstGroup = familyGroups[0].group;
    // Only set defaults if not already set from initialData
    if (initialData?.isFamily === undefined) {
      setIsFamily(true);
    }
    if (!initialData?.familyGroupId && !familyGroupId) {
      setFamilyGroupId(firstGroup.id.toString());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyGroups]);

  const createMutation = trpc.transactions.create.useMutation({
    onSuccess: () => {
      utils.transactions.list.invalidate();
      utils.reports.summary.invalidate();
      utils.reports.byCategory.invalidate();
      toast.success("Транзакция добавлена");
      onSuccess?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.transactions.update.useMutation({
    onSuccess: () => {
      utils.transactions.list.invalidate();
      utils.reports.summary.invalidate();
      utils.reports.byCategory.invalidate();
      toast.success("Транзакция обновлена");
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

  const handleSubmit = () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Введите сумму");
      return;
    }
    if (!categoryId) {
      toast.error("Выберите категорию");
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
        sourceLanguage: initialData?.sourceLanguage,
        rawTranscription: initialData?.rawTranscription,
      });
    }
  };

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
          Расход
        </Button>
        <Button
          variant={type === "income" ? "default" : "outline"}
          className={`flex-1 ${type === "income" ? "bg-income text-white" : ""}`}
          onClick={() => setType("income")}
        >
          <ArrowUpCircle className="h-4 w-4 mr-2" />
          Доход
        </Button>
      </div>

      {/* Amount + Currency */}
      <div className="flex gap-2">
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground mb-1">Сумма</Label>
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
          <Label className="text-xs text-muted-foreground mb-1">Валюта</Label>
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
        <Label className="text-xs text-muted-foreground mb-1">Категория</Label>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="h-12">
            <SelectValue placeholder="Выберите категорию" />
          </SelectTrigger>
          <SelectContent>
            {filteredCategories.map((c) => (
              <SelectItem key={c.id} value={c.id.toString()}>
                <span className="flex items-center gap-2">
                  <span>{c.icon}</span>
                  <span>{c.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Description */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1">Описание</Label>
        <Input
          placeholder="Описание транзакции"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="h-12"
        />
      </div>

      {/* Date */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1">Дата</Label>
        <Input
          type="date"
          value={dateStr}
          onChange={(e) => setDateStr(e.target.value)}
          className="h-12"
        />
      </div>

      {/* Family toggle */}
      {familyGroups && familyGroups.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Button
              variant={!isFamily ? "default" : "outline"}
              size="sm"
              onClick={() => setIsFamily(false)}
            >
              Личное
            </Button>
            <Button
              variant={isFamily ? "default" : "outline"}
              size="sm"
              onClick={() => setIsFamily(true)}
            >
              Семейное
            </Button>
          </div>
          {isFamily && (
            <Select value={familyGroupId} onValueChange={setFamilyGroupId}>
              <SelectTrigger className="h-12">
                <SelectValue placeholder="Выберите группу" />
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
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        {onCancel && (
          <Button variant="outline" className="flex-1 h-12" onClick={onCancel}>
            Отмена
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
            "Сохранить"
          ) : (
            "Добавить"
          )}
        </Button>
      </div>
    </div>
  );
}
