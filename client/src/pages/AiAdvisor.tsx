import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Square, Send, Loader2, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import ReactMarkdown from "react-markdown";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export default function AiAdvisor() {
  const { t } = useLanguage();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const askMutation = trpc.aiAdvisor.ask.useMutation();
  const transcribeAndAskMutation = trpc.aiAdvisor.transcribeAndAsk.useMutation();

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSendText = useCallback(async () => {
    const question = inputText.trim();
    if (!question || isLoading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: question,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setIsLoading(true);

    try {
      const result = await askMutation.mutateAsync({ question });
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: result.response,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      toast.error(err?.message || t("ai_error"));
    } finally {
      setIsLoading(false);
    }
  }, [inputText, isLoading, askMutation, t]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendText();
      }
    },
    [handleSendText]
  );

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
          toast.error(t("ai_recording_too_short"));
          return;
        }

        setIsTranscribing(true);
        try {
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onload = () => {
              const result = reader.result as string;
              resolve(result.split(",")[1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          // Add user message with transcription placeholder
          const userMsg: ChatMessage = {
            id: Date.now().toString(),
            role: "user",
            content: "🎙️ ...",
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, userMsg]);
          setIsLoading(true);

          const result = await transcribeAndAskMutation.mutateAsync({
            audioBase64: base64,
            mimeType: "audio/webm",
          });

          // Update user message with actual transcription
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === userMsg.id
                ? { ...msg, content: `🎙️ ${result.transcription}` }
                : msg
            )
          );

          // Add AI response
          const assistantMsg: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: result.response,
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
        } catch (err: any) {
          toast.error(err?.message || t("ai_error"));
          // Remove the placeholder message on error
          setMessages((prev) => prev.slice(0, -1));
        } finally {
          setIsTranscribing(false);
          setIsLoading(false);
          setRecordingDuration(0);
        }
      };

      mediaRecorder.start(250);
      setIsRecording(true);
      setRecordingDuration(0);

      timerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      toast.error(t("ai_no_mic"));
    }
  }, [transcribeAndAskMutation, t]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
  }, []);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // Suggested questions
  const suggestions = [
    t("ai_suggestion_1"),
    t("ai_suggestion_2"),
    t("ai_suggestion_3"),
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">{t("ai_title")}</h1>
            <p className="text-[10px] text-muted-foreground">{t("ai_subtitle")}</p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="icon" onClick={clearChat} className="h-8 w-8">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-lg font-semibold">{t("ai_welcome_title")}</h2>
              <p className="text-sm text-muted-foreground max-w-[280px]">
                {t("ai_welcome_desc")}
              </p>
            </div>
            {/* Suggestion chips */}
            <div className="flex flex-col gap-2 w-full max-w-[300px]">
              {suggestions.map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setInputText(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="text-left text-xs px-3 py-2.5 rounded-xl bg-muted/50 hover:bg-muted border border-border/50 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-muted/70 border border-border/50 rounded-bl-md"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-muted/70 border border-border/50 rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">{t("ai_thinking")}</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t border-border px-4 py-3 bg-background">
        <div className="flex items-end gap-2">
          {/* Voice button */}
          <Button
            variant="ghost"
            size="icon"
            className={`shrink-0 h-10 w-10 rounded-full ${
              isRecording
                ? "bg-destructive/20 text-destructive voice-pulse"
                : isTranscribing
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isLoading && !isRecording}
          >
            {isTranscribing ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : isRecording ? (
              <Square className="h-4 w-4" fill="currentColor" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </Button>

          {isRecording ? (
            <div className="flex-1 flex items-center justify-center h-10">
              <span className="text-sm text-destructive font-medium">
                {t("ai_recording")} {formatDuration(recordingDuration)}
              </span>
            </div>
          ) : (
            <>
              {/* Text input */}
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("ai_input_placeholder")}
                className="flex-1 resize-none bg-muted/50 border border-border/50 rounded-2xl px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 max-h-24 min-h-[40px]"
                rows={1}
                disabled={isLoading}
              />

              {/* Send button */}
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 h-10 w-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                onClick={handleSendText}
                disabled={!inputText.trim() || isLoading}
              >
                <Send className="h-5 w-5" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
