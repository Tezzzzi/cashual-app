import { useState, useRef, useCallback } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type VoiceRecorderProps = {
  onResult: (data: {
    transcription: string;
    parsed: {
      type: "income" | "expense";
      amount: number;
      currency: string;
      categoryId?: number;
      categoryName: string;
      categoryIcon: string;
      description: string;
      date: number;
      language: string;
    };
    rawTranscription: string;
  }) => void;
  language?: string;
};

export default function VoiceRecorder({ onResult, language }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const transcribeAndParse = trpc.voice.transcribeAndParse.useMutation();

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      chunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size < 1000) {
          toast.error("Запись слишком короткая");
          return;
        }

        setIsProcessing(true);
        try {
          // Convert to base64 for transcription
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onload = () => {
              const result = reader.result as string;
              resolve(result.split(",")[1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          // Transcribe audio directly (no upload needed)
          const result = await transcribeAndParse.mutateAsync({
            audioBase64: base64,
            mimeType: "audio/webm",
            language,
          });

          onResult(result);
          toast.success("Голос распознан!");
        } catch (err: any) {
          toast.error(err?.message || "Ошибка обработки голоса");
        } finally {
          setIsProcessing(false);
          setDuration(0);
        }
      };

      mediaRecorder.start(250);
      setIsRecording(true);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      toast.error("Нет доступа к микрофону");
    }
  }, [language, onResult, transcribeAndParse]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  if (isProcessing) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
        </div>
        <p className="text-sm text-muted-foreground">Обработка голоса...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <Button
        variant="ghost"
        size="icon"
        className={`w-20 h-20 rounded-full transition-all ${
          isRecording
            ? "bg-destructive/20 text-destructive voice-pulse"
            : "bg-primary/20 text-primary hover:bg-primary/30"
        }`}
        onClick={isRecording ? stopRecording : startRecording}
      >
        {isRecording ? (
          <Square className="h-8 w-8" fill="currentColor" />
        ) : (
          <Mic className="h-10 w-10" />
        )}
      </Button>
      {isRecording ? (
        <p className="text-sm text-destructive font-medium">
          Запись {formatDuration(duration)}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Нажмите для записи голоса
        </p>
      )}
    </div>
  );
}
