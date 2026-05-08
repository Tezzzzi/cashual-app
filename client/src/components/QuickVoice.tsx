import { useState, useRef, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useLanguage } from "@/contexts/LanguageContext";
import { Mic, MicOff, Check, X, Undo2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface ParsedTx {
  type: "income" | "expense";
  amount: number;
  currency: string;
  categoryId?: number;
  categoryName: string;
  categoryIcon: string;
  description: string;
  date: number;
  budgetContext: string;
  isFamily: boolean;
  isWork: boolean;
  businessGroupId: number | null;
  detectedBusinessGroupName: string | null;
}

interface SavedTxInfo {
  id: number;
  categoryIcon: string;
  categoryName: string;
  amount: number;
  currency: string;
  type: "income" | "expense";
  description: string;
}

type QuickVoiceState =
  | "idle"
  | "recording"
  | "processing"
  | "confirm"
  | "saving"
  | "undo";

export default function QuickVoice() {
  const { t, translateCategory } = useLanguage();
  const utils = trpc.useUtils();

  const [state, setState] = useState<QuickVoiceState>("idle");
  const [parsedTransactions, setParsedTransactions] = useState<ParsedTx[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [savedTransactions, setSavedTransactions] = useState<SavedTxInfo[]>([]);
  const [undoTimer, setUndoTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [undoCountdown, setUndoCountdown] = useState(5);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // tRPC mutations
  const transcribeAndParse = trpc.voice.transcribeAndParse.useMutation();
  const createTransaction = trpc.transactions.create.useMutation();
  const deleteTransaction = trpc.transactions.delete.useMutation();

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (undoTimer) clearTimeout(undoTimer);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [undoTimer]);

  // Undo countdown effect
  useEffect(() => {
    if (state !== "undo") return;
    if (undoCountdown <= 0) {
      setState("idle");
      setSavedTransactions([]);
      return;
    }
    const interval = setInterval(() => {
      setUndoCountdown((c) => c - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [state, undoCountdown]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size < 1000) {
          setState("idle");
          toast.error(t("qv_too_short") || "Recording too short");
          return;
        }

        setState("processing");

        // Convert to base64
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(",")[1];
          try {
            const result = await transcribeAndParse.mutateAsync({
              audio: base64,
              mimeType: "audio/webm",
            });

            const txs: ParsedTx[] = (result.transactions || []).map((tx: any) => ({
              type: tx.type,
              amount: tx.amount,
              currency: tx.currency,
              categoryId: tx.categoryId,
              categoryName: tx.categoryName,
              categoryIcon: tx.categoryIcon || "📦",
              description: tx.description,
              date: tx.date,
              budgetContext: tx.budgetContext || "personal",
              isFamily: tx.isFamily || false,
              isWork: tx.isWork || false,
              businessGroupId: tx.businessGroupId || null,
              detectedBusinessGroupName: tx.detectedBusinessGroupName || null,
            }));

            if (txs.length === 0) {
              setState("idle");
              toast.error(t("qv_no_transactions") || "Could not parse any transactions");
              return;
            }

            setParsedTransactions(txs);
            setSelectedIndices(new Set(txs.map((_, i) => i)));
            setState("confirm");
          } catch (err: any) {
            setState("idle");
            toast.error(err.message || "Error parsing voice");
          }
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setState("recording");
    } catch (err: any) {
      toast.error(t("qv_mic_error") || "Microphone access denied");
      setState("idle");
    }
  }, [t, transcribeAndParse]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handleFabClick = useCallback(() => {
    if (state === "idle") {
      startRecording();
    } else if (state === "recording") {
      stopRecording();
    }
  }, [state, startRecording, stopRecording]);

  const toggleSelect = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleConfirm = async () => {
    const toSave = parsedTransactions.filter((_, i) => selectedIndices.has(i));
    if (toSave.length === 0) {
      handleDiscard();
      return;
    }

    setState("saving");
    const savedIds: SavedTxInfo[] = [];

    try {
      for (const tx of toSave) {
        const result = await createTransaction.mutateAsync({
          categoryId: tx.categoryId || 1,
          type: tx.type,
          amount: String(tx.amount),
          currency: tx.currency,
          description: tx.description,
          date: tx.date,
          isFamily: tx.isFamily,
          familyGroupId: null,
          isWork: tx.isWork,
          businessGroupId: tx.businessGroupId,
        });

        if (result?.id) {
          savedIds.push({
            id: result.id,
            categoryIcon: tx.categoryIcon,
            categoryName: tx.categoryName,
            amount: tx.amount,
            currency: tx.currency,
            type: tx.type,
            description: tx.description,
          });
        }
      }

      // Invalidate queries
      utils.transactions.list.invalidate();
      utils.reports.summary.invalidate();

      // Show undo state
      setSavedTransactions(savedIds);
      setParsedTransactions([]);
      setSelectedIndices(new Set());
      setUndoCountdown(5);
      setState("undo");

      // Auto-dismiss after 5 seconds
      const timer = setTimeout(() => {
        setState("idle");
        setSavedTransactions([]);
      }, 5500);
      setUndoTimer(timer);
    } catch (err: any) {
      toast.error(err.message || "Error saving");
      setState("confirm");
    }
  };

  const handleDiscard = () => {
    setState("idle");
    setParsedTransactions([]);
    setSelectedIndices(new Set());
  };

  const handleUndo = async () => {
    if (undoTimer) clearTimeout(undoTimer);
    setUndoTimer(null);

    try {
      for (const tx of savedTransactions) {
        await deleteTransaction.mutateAsync({ id: tx.id });
      }
      utils.transactions.list.invalidate();
      utils.reports.summary.invalidate();
      toast.success(t("qv_undone") || "Undone!");
    } catch (err: any) {
      toast.error(err.message || "Undo failed");
    }

    setState("idle");
    setSavedTransactions([]);
  };

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <>
      {/* Overlay for confirm/undo states */}
      {(state === "confirm" || state === "saving") && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-end justify-center pb-28">
          <div className="bg-card border border-border rounded-2xl p-4 mx-4 w-full max-w-sm shadow-xl animate-in slide-in-from-bottom-4 duration-300">
            {/* Transaction cards */}
            <div className="space-y-2 max-h-60 overflow-y-auto mb-3">
              {parsedTransactions.map((tx, i) => (
                <div
                  key={i}
                  onClick={() => toggleSelect(i)}
                  className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${
                    selectedIndices.has(i)
                      ? "bg-primary/10 border border-primary/30"
                      : "bg-muted/50 border border-transparent opacity-50"
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-lg shrink-0">
                    {tx.categoryIcon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {tx.description || translateCategory(tx.categoryName)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {translateCategory(tx.categoryName)}
                    </p>
                  </div>
                  <p
                    className={`text-sm font-bold shrink-0 ${
                      tx.type === "income" ? "text-income" : "text-expense"
                    }`}
                  >
                    {tx.type === "income" ? "+" : "-"}
                    {tx.amount.toLocaleString("ru-RU", { minimumFractionDigits: 2 })}{" "}
                    {tx.currency}
                  </p>
                </div>
              ))}
            </div>

            {/* Confirm / Cancel buttons */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 h-11"
                onClick={handleDiscard}
                disabled={state === "saving"}
              >
                <X className="h-4 w-4 mr-1" />
                {t("cancel")}
              </Button>
              <Button
                className="flex-1 h-11"
                onClick={handleConfirm}
                disabled={state === "saving" || selectedIndices.size === 0}
              >
                {state === "saving" ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Check className="h-4 w-4 mr-1" />
                )}
                {t("save")} {selectedIndices.size > 0 && `(${selectedIndices.size})`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Undo toast */}
      {state === "undo" && (
        <div className="fixed bottom-24 left-4 right-4 z-50 flex justify-center animate-in slide-in-from-bottom-2 duration-200">
          <div className="bg-card border border-border rounded-xl px-4 py-3 shadow-xl flex items-center gap-3 max-w-sm w-full">
            <div className="flex-1">
              <p className="text-sm font-medium">
                ✅ {savedTransactions.length > 1
                  ? `${savedTransactions.length} ${t("qv_saved_plural") || "transactions saved"}`
                  : `${savedTransactions[0]?.categoryIcon} ${savedTransactions[0]?.description || translateCategory(savedTransactions[0]?.categoryName || "")} ${savedTransactions[0]?.type === "income" ? "+" : "-"}${savedTransactions[0]?.amount} ${savedTransactions[0]?.currency}`
                }
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={handleUndo}
            >
              <Undo2 className="h-4 w-4 mr-1" />
              {t("qv_undo") || "Undo"} ({undoCountdown})
            </Button>
          </div>
        </div>
      )}

      {/* FAB button */}
      <button
        onClick={handleFabClick}
        disabled={state === "processing" || state === "saving" || state === "confirm"}
        className={`fixed bottom-20 right-4 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 ${
          state === "recording"
            ? "bg-red-500 scale-110 animate-pulse shadow-red-500/40"
            : state === "processing"
            ? "bg-primary/70 cursor-wait"
            : "bg-primary hover:bg-primary/90 hover:scale-105 active:scale-95"
        }`}
      >
        {state === "processing" ? (
          <Loader2 className="h-6 w-6 text-white animate-spin" />
        ) : state === "recording" ? (
          <MicOff className="h-6 w-6 text-white" />
        ) : (
          <Mic className="h-6 w-6 text-white" />
        )}
      </button>

      {/* Recording indicator */}
      {state === "recording" && (
        <div className="fixed bottom-36 right-3 z-50 bg-red-500/90 text-white text-xs px-3 py-1.5 rounded-full animate-pulse shadow-lg">
          🎙️ {t("qv_recording") || "Recording..."}
        </div>
      )}

      {/* Processing indicator */}
      {state === "processing" && (
        <div className="fixed bottom-36 right-3 z-50 bg-primary/90 text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
          ⏳ {t("qv_processing") || "Analyzing..."}
        </div>
      )}
    </>
  );
}
