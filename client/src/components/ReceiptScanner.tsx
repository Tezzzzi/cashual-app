import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Camera, ImagePlus, Loader2, CheckCircle, AlertCircle, ScanLine, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/_core/hooks/useAuth";

type ParsedTransaction = {
  type: "income" | "expense";
  amount: number;
  currency: string;
  categoryId?: number;
  categoryName: string;
  categoryIcon: string;
  description: string;
  date: number;
  confidence: "high" | "medium" | "low";
};

type ParseResult = {
  imageType: "bank_screenshot" | "store_receipt" | "other";
  transactions: ParsedTransaction[];
  imageUrl: string;
};

type ReceiptScannerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

export default function ReceiptScanner({ open, onOpenChange, onSuccess }: ReceiptScannerProps) {
  const { t, translateCategory } = useLanguage();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"select" | "processing" | "review">("select");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  const utils = trpc.useUtils();

  const parseReceiptMutation = trpc.voice.parseReceipt.useMutation({
    onSuccess: (data) => {
      setParseResult(data as ParseResult);
      setSelectedIndices(new Set(data.transactions.map((_, i) => i)));
      setStep("review");
    },
    onError: (err) => {
      toast.error(err.message || t("receipt_error"));
      setStep("select");
    },
  });

  const saveMutation = trpc.voice.saveReceiptTransactions.useMutation({
    onSuccess: (result) => {
      utils.transactions.list.invalidate();
      utils.reports.summary.invalidate();
      const msg =
        result.skipped > 0
          ? `${t("transaction_added")}: ${result.saved} (${result.skipped} duplicates skipped)`
          : `${t("transaction_added")}: ${result.saved}`;
      toast.success(msg);
      handleClose();
      onSuccess?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image too large (max 10MB)");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setStep("processing");
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = (e.target?.result as string).split(",")[1];
      parseReceiptMutation.mutate({ imageBase64: base64, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  };

  const handleReset = () => {
    setStep("select");
    setPreviewUrl(null);
    setParseResult(null);
    setSelectedIndices(new Set());
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  };

  const handleClose = () => {
    handleReset();
    onOpenChange(false);
  };

  const toggleSelect = (idx: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleSave = () => {
    if (!parseResult) return;
    const defaultBudget = (user as any)?.defaultBudget || "personal";
    const isFamily = defaultBudget === "family";
    const familyGroupId = isFamily ? (user as any)?.familyGroupId ?? null : null;

    const toSave = parseResult.transactions
      .filter((_, i) => selectedIndices.has(i))
      .map((tx) => ({
        categoryId: tx.categoryId ?? 1,
        type: tx.type,
        amount: tx.amount.toFixed(2),
        currency: tx.currency,
        description: tx.description,
        date: tx.date,
        isFamily,
        familyGroupId,
      }));

    if (toSave.length === 0) {
      toast.error("No transactions selected");
      return;
    }

    saveMutation.mutate({ transactions: toSave });
  };

  const confidenceColor = {
    high: "text-green-400",
    medium: "text-yellow-400",
    low: "text-red-400",
  };

  const imageTypeLabel: Record<string, string> = {
    bank_screenshot: "🏦 Bank/Wallet screenshot",
    store_receipt: "🧾 Store receipt",
    other: "📄 Document",
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md mx-auto max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" />
            {t("receipt_title")}
          </DialogTitle>
        </DialogHeader>

        {/* Step: Select image */}
        {step === "select" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("receipt_desc")}</p>
            <Button className="w-full h-14 gap-3" onClick={() => cameraInputRef.current?.click()}>
              <Camera className="h-5 w-5" />
              {t("take_photo")}
            </Button>
            <Button variant="outline" className="w-full h-14 gap-3" onClick={() => fileInputRef.current?.click()}>
              <ImagePlus className="h-5 w-5" />
              {t("upload_image")}
            </Button>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ""; }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ""; }}
            />
          </div>
        )}

        {/* Step: Processing */}
        {step === "processing" && (
          <div className="space-y-4">
            {previewUrl && (
              <div className="rounded-lg overflow-hidden border border-border max-h-48">
                <img src={previewUrl} alt="Receipt preview" className="w-full object-contain max-h-48" />
              </div>
            )}
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="relative">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <ScanLine className="h-5 w-5 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <p className="text-sm font-medium">{t("processing_receipt")}</p>
              <p className="text-xs text-muted-foreground text-center">{t("processing_receipt_desc")}</p>
            </div>
          </div>
        )}

        {/* Step: Review multi-transaction results */}
        {step === "review" && parseResult && (
          <div className="space-y-4">
            {/* Image preview + type badge */}
            <div className="flex gap-3 items-start">
              {previewUrl && (
                <div className="w-14 h-14 rounded-lg overflow-hidden border border-border flex-shrink-0">
                  <img src={previewUrl} alt="Receipt" className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="h-4 w-4 text-green-400" />
                  <span className="text-sm font-medium">{t("receipt_recognized")}</span>
                </div>
                <p className="text-xs text-muted-foreground">{imageTypeLabel[parseResult.imageType]}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {parseResult.transactions.length} transaction{parseResult.transactions.length !== 1 ? "s" : ""} found
                  {" · "}{selectedIndices.size} selected
                </p>
              </div>
            </div>

            {/* Transaction list with checkboxes */}
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {parseResult.transactions.map((tx, i) => {
                const isSelected = selectedIndices.has(i);
                return (
                  <div
                    key={i}
                    onClick={() => toggleSelect(i)}
                    className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? "border-primary/50 bg-primary/5"
                        : "border-border bg-muted/30 opacity-50"
                    }`}
                  >
                    {/* Checkbox indicator */}
                    <div
                      className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${
                        isSelected ? "border-primary bg-primary" : "border-muted-foreground"
                      }`}
                    >
                      {isSelected && <span className="text-[8px] text-primary-foreground font-bold">✓</span>}
                    </div>

                    {/* Category icon */}
                    <span className="text-base flex-shrink-0">{tx.categoryIcon}</span>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{tx.description}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {translateCategory(tx.categoryName)} · {new Date(tx.date).toLocaleDateString()}
                      </p>
                    </div>

                    {/* Amount + confidence */}
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-semibold ${tx.type === "income" ? "text-green-400" : "text-red-400"}`}>
                        {tx.type === "income" ? "+" : "-"}{tx.amount.toFixed(2)} {tx.currency}
                      </p>
                      <span className={`text-[9px] ${confidenceColor[tx.confidence]}`}>{tx.confidence}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Low confidence warning */}
            {parseResult.transactions.some((tx) => tx.confidence === "low") && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <AlertCircle className="h-3.5 w-3.5 text-yellow-400 flex-shrink-0" />
                <span className="text-[10px] text-yellow-400">{t("review_carefully")}</span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1 h-11 gap-2" onClick={handleReset}>
                <Trash2 className="h-4 w-4" />
                {t("cancel")}
              </Button>
              <Button
                className="flex-1 h-11 gap-2"
                onClick={handleSave}
                disabled={saveMutation.isPending || selectedIndices.size === 0}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {t("save")} ({selectedIndices.size})
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
