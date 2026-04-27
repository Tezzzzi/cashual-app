import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Camera, ImagePlus, Loader2, ScanLine, X, Plus, Images } from "lucide-react";
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

type ImageItem = {
  file: File;
  previewUrl: string;
  status: "pending" | "processing" | "done" | "error";
  result?: ParseResult;
  error?: string;
};

type DuplicateInfo = {
  index: number;
  existingDescription: string;
  existingAmount: string;
  existingDate: number;
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
  const addMoreInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"select" | "processing" | "review">("select");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [allTransactions, setAllTransactions] = useState<ReviewTransaction[]>([]);
  const [duplicateIndices, setDuplicateIndices] = useState<Set<number>>(new Set());
  const [duplicateInfos, setDuplicateInfos] = useState<DuplicateInfo[]>([]);
  const [processingProgress, setProcessingProgress] = useState({ done: 0, total: 0 });

  const utils = trpc.useUtils();

  const parseReceiptMutation = trpc.voice.parseReceipt.useMutation();
  const checkDuplicatesMutation = trpc.voice.checkDuplicates.useMutation();

  const saveMutation = trpc.voice.saveReceiptTransactions.useMutation({
    onSuccess: (result) => {
      utils.transactions.list.invalidate();
      utils.reports.summary.invalidate();
      const msg =
        result.skipped > 0
          ? `${t("transaction_added")}: ${result.saved} (${result.skipped} ${t("duplicates_skipped") || "duplicates skipped"})`
          : `${t("transaction_added")}: ${result.saved}`;
      toast.success(msg);
      handleClose();
      onSuccess?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const addFiles = (files: FileList | File[]) => {
    const newImages: ImageItem[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name}: ${t("image_too_large") || "Image too large (max 10MB)"}`);
        continue;
      }
      newImages.push({
        file,
        previewUrl: URL.createObjectURL(file),
        status: "pending",
      });
    }
    if (newImages.length === 0) return;
    setImages((prev) => [...prev, ...newImages]);
  };

  const removeImage = (idx: number) => {
    setImages((prev) => {
      const item = prev[idx];
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const processAllImages = async () => {
    if (images.length === 0) return;
    setStep("processing");
    setProcessingProgress({ done: 0, total: images.length });

    const allParsed: ReviewTransaction[] = [];
    const updatedImages = [...images];

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      updatedImages[i] = { ...img, status: "processing" };
      setImages([...updatedImages]);

      try {
        const base64 = await fileToBase64(img.file);
        const result = await parseReceiptMutation.mutateAsync({
          imageBase64: base64,
          mimeType: img.file.type,
        });
        updatedImages[i] = { ...img, status: "done", result: result as ParseResult };
        const txs = (result as ParseResult).transactions.map((tx) => ({
          ...tx,
          confidence: tx.confidence || ("medium" as const),
        }));
        allParsed.push(...(txs as ReviewTransaction[]));
      } catch (err: any) {
        updatedImages[i] = { ...img, status: "error", error: err.message };
        toast.error(`${t("receipt_error") || "Error"}: ${img.file.name}`);
      }

      setImages([...updatedImages]);
      setProcessingProgress({ done: i + 1, total: images.length });
    }

    if (allParsed.length === 0) {
      toast.error(t("no_transactions_found") || "No transactions found in images");
      setStep("select");
      return;
    }

    setAllTransactions(allParsed);

    // Check for duplicates against existing DB transactions
    try {
      const dupeResult = await checkDuplicatesMutation.mutateAsync({
        transactions: allParsed.map((tx) => ({
          amount: tx.amount.toFixed(2),
          description: tx.description,
          date: tx.date,
          type: tx.type,
        })),
      });

      if (dupeResult.duplicates.length > 0) {
        setDuplicateIndices(new Set(dupeResult.duplicates.map((d: any) => d.index)));
        setDuplicateInfos(dupeResult.duplicates);
      }
    } catch {
      // Non-critical — proceed without duplicate info
    }

    setStep("review");
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleReset = () => {
    setStep("select");
    images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setImages([]);
    setAllTransactions([]);
    setDuplicateIndices(new Set());
    setDuplicateInfos([]);
    setProcessingProgress({ done: 0, total: 0 });
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

        {/* Step: Select images */}
        {step === "select" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("receipt_desc_multi") || t("receipt_desc") || "Take photos or upload images of receipts and bank statements"}
            </p>

            {/* Image thumbnails grid */}
            {images.length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {images.map((img, i) => (
                  <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-border group">
                    <img src={img.previewUrl} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeImage(i)}
                      className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </div>
                ))}
                {/* Add more button in grid */}
                <button
                  onClick={() => addMoreInputRef.current?.click()}
                  className="aspect-square rounded-lg border-2 border-dashed border-border flex items-center justify-center hover:border-primary/50 transition-colors"
                >
                  <Plus className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>
            )}

            {/* Action buttons */}
            {images.length === 0 ? (
              <>
                <Button className="w-full h-14 gap-3" onClick={() => cameraInputRef.current?.click()}>
                  <Camera className="h-5 w-5" />
                  {t("take_photo")}
                </Button>
                <Button variant="outline" className="w-full h-14 gap-3" onClick={() => fileInputRef.current?.click()}>
                  <Images className="h-5 w-5" />
                  {t("upload_images") || t("upload_image") || "Upload Images"}
                </Button>
              </>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-11 gap-2" onClick={() => cameraInputRef.current?.click()}>
                  <Camera className="h-4 w-4" />
                  {t("take_photo")}
                </Button>
                <Button className="flex-1 h-11 gap-2" onClick={processAllImages}>
                  <ScanLine className="h-4 w-4" />
                  {t("process_images") || "Process"} ({images.length})
                </Button>
              </div>
            )}

            {/* Hidden file inputs */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) addFiles([f]);
                e.target.value = "";
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={addMoreInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        )}

        {/* Step: Processing */}
        {step === "processing" && (
          <div className="space-y-4">
            {/* Image thumbnails with status */}
            <div className="grid grid-cols-4 gap-2">
              {images.map((img, i) => (
                <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-border">
                  <img src={img.previewUrl} alt="" className="w-full h-full object-cover" />
                  <div className={`absolute inset-0 flex items-center justify-center ${
                    img.status === "done" ? "bg-green-500/30" :
                    img.status === "error" ? "bg-red-500/30" :
                    img.status === "processing" ? "bg-black/40" : "bg-black/20"
                  }`}>
                    {img.status === "processing" && <Loader2 className="h-5 w-5 text-white animate-spin" />}
                    {img.status === "done" && <span className="text-lg">✓</span>}
                    {img.status === "error" && <span className="text-lg">✗</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col items-center gap-3 py-2">
              <div className="relative">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <ScanLine className="h-5 w-5 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <p className="text-sm font-medium">{t("processing_receipt")}</p>
              <p className="text-xs text-muted-foreground text-center">
                {processingProgress.done}/{processingProgress.total} {t("images_processed") || "images processed"}
              </p>
            </div>
          </div>
        )}

        {/* Step: Review with budget selection + duplicate warnings */}
        {step === "review" && allTransactions.length > 0 && (
          <MultiTransactionReview
            transactions={allTransactions}
            duplicateIndices={duplicateIndices}
            duplicateInfos={duplicateInfos}
            previewUrl={images[0]?.previewUrl}
            imageCount={images.length}
            onSave={handleSaveTransactions}
            onCancel={handleReset}
            isSaving={saveMutation.isPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
