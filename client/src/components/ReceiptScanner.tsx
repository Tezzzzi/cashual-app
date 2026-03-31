import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Camera, ImagePlus, Loader2, CheckCircle, AlertCircle, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import TransactionForm from "./TransactionForm";

type ParsedReceipt = {
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
  const [parsedData, setParsedData] = useState<ParsedReceipt | null>(null);

  const parseReceiptMutation = trpc.voice.parseReceipt.useMutation({
    onSuccess: (data) => {
      setParsedData(data.parsed as ParsedReceipt);
      setStep("review");
    },
    onError: (err) => {
      toast.error(err.message || t("receipt_error"));
      setStep("select");
    },
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

    // Show preview
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setStep("processing");

    // Convert to base64
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = (e.target?.result as string).split(",")[1];
      parseReceiptMutation.mutate({
        imageBase64: base64,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleReset = () => {
    setStep("select");
    setPreviewUrl(null);
    setParsedData(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  };

  const handleClose = () => {
    handleReset();
    onOpenChange(false);
  };

  const confidenceColor = {
    high: "text-green-400",
    medium: "text-yellow-400",
    low: "text-red-400",
  };

  const confidenceLabel = {
    high: t("confidence_high"),
    medium: t("confidence_medium"),
    low: t("confidence_low"),
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

        {step === "select" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("receipt_desc")}</p>

            {/* Camera capture */}
            <Button
              className="w-full h-14 gap-3"
              onClick={() => cameraInputRef.current?.click()}
            >
              <Camera className="h-5 w-5" />
              {t("take_photo")}
            </Button>

            {/* File upload */}
            <Button
              variant="outline"
              className="w-full h-14 gap-3"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="h-5 w-5" />
              {t("upload_image")}
            </Button>

            {/* Hidden inputs */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageFile(file);
                e.target.value = "";
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageFile(file);
                e.target.value = "";
              }}
            />
          </div>
        )}

        {step === "processing" && (
          <div className="space-y-4">
            {/* Image preview */}
            {previewUrl && (
              <div className="rounded-lg overflow-hidden border border-border max-h-48">
                <img
                  src={previewUrl}
                  alt="Receipt preview"
                  className="w-full object-contain max-h-48"
                />
              </div>
            )}

            {/* Processing indicator */}
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="relative">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <ScanLine className="h-5 w-5 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <p className="text-sm font-medium">{t("processing_receipt")}</p>
              <p className="text-xs text-muted-foreground text-center">
                {t("processing_receipt_desc")}
              </p>
            </div>
          </div>
        )}

        {step === "review" && parsedData && (
          <div className="space-y-4">
            {/* Preview + confidence */}
            <div className="flex gap-3 items-start">
              {previewUrl && (
                <div className="w-16 h-16 rounded-lg overflow-hidden border border-border flex-shrink-0">
                  <img
                    src={previewUrl}
                    alt="Receipt"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="h-4 w-4 text-green-400" />
                  <span className="text-sm font-medium">{t("receipt_recognized")}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">{t("confidence")}:</span>
                  <span className={`text-xs font-medium ${confidenceColor[parsedData.confidence]}`}>
                    {confidenceLabel[parsedData.confidence]}
                  </span>
                </div>
                {parsedData.confidence === "low" && (
                  <div className="flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3 text-yellow-400" />
                    <span className="text-[10px] text-yellow-400">{t("review_carefully")}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Transaction form pre-filled with parsed data */}
            <div className="border-t border-border pt-4">
              <p className="text-xs text-muted-foreground mb-3">{t("review_and_confirm")}</p>
              <TransactionForm
                initialData={{
                  type: parsedData.type,
                  amount: parsedData.amount,
                  currency: parsedData.currency,
                  categoryId: parsedData.categoryId,
                  description: parsedData.description,
                  date: parsedData.date,
                }}
                onSuccess={() => {
                  handleClose();
                  onSuccess?.();
                  toast.success(t("transaction_added"));
                }}
                onCancel={() => {
                  handleReset();
                }}
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
