import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Camera, ImagePlus, Loader2, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import MultiTransactionReview, { type ReviewTransaction } from "./MultiTransactionReview";

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
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"select" | "processing" | "review">("select");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);

  const utils = trpc.useUtils();

  const parseReceiptMutation = trpc.voice.parseReceipt.useMutation({
    onSuccess: (data) => {
      setParseResult(data as ParseResult);
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
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  };

  const handleClose = () => {
    handleReset();
    onOpenChange(false);
  };

  const handleSaveTransactions = (
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
    saveMutation.mutate({ transactions });
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

        {/* Step: Review with budget selection */}
        {step === "review" && parseResult && (
          <MultiTransactionReview
            transactions={parseResult.transactions as ReviewTransaction[]}
            imageType={parseResult.imageType}
            previewUrl={previewUrl}
            onSave={handleSaveTransactions}
            onCancel={handleReset}
            isSaving={saveMutation.isPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
