import { ENV } from "./env";

export type TranscribeOptions = {
  audioBuffer: Buffer;
  language?: string;
  mimeType?: string;
};

export type WhisperResponse = {
  text: string;
  language: string;
};

export type TranscriptionError = {
  error: string;
  code: "FILE_TOO_LARGE" | "INVALID_FORMAT" | "TRANSCRIPTION_FAILED" | "SERVICE_ERROR";
  details?: string;
};

/**
 * Transcribe audio to text using OpenAI Whisper API
 */
export async function transcribeAudio(
  options: TranscribeOptions
): Promise<WhisperResponse | TranscriptionError> {
  try {
    if (!ENV.openaiApiKey) {
      return {
        error: "OpenAI API key is not configured",
        code: "SERVICE_ERROR",
        details: "OPENAI_API_KEY is not set",
      };
    }

    // Check file size (25MB limit for Whisper)
    const sizeMB = options.audioBuffer.length / (1024 * 1024);
    if (sizeMB > 25) {
      return {
        error: "Audio file exceeds maximum size limit",
        code: "FILE_TOO_LARGE",
        details: `File size is ${sizeMB.toFixed(2)}MB, maximum allowed is 25MB`,
      };
    }

    // Create FormData for multipart upload
    const formData = new FormData();

    // Convert Buffer to Blob
    const mimeType = options.mimeType || "audio/webm";
    const audioBlob = new Blob([new Uint8Array(options.audioBuffer)], { type: mimeType });
    formData.append("file", audioBlob, "audio.webm");

    formData.append("model", "whisper-1");
    formData.append("language", options.language || "ru");

    const prompt =
      options.language === "ru"
        ? "Это финансовая транзакция. Распознай сумму, категорию и описание."
        : options.language === "az"
          ? "Bu maliyyə əməliyyatıdır. Məbləğ, kateqoriya və təsviri tanı."
          : "This is a financial transaction. Recognize the amount, category, and description.";

    formData.append("prompt", prompt);

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.openaiApiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        error: "Transcription service request failed",
        code: "TRANSCRIPTION_FAILED",
        details: `${response.status} ${response.statusText}${errorText ? `: ${errorText}` : ""}`,
      };
    }

    const result = (await response.json()) as { text: string };

    // Detect language from the transcription
    const detectedLanguage = options.language || "ru";

    return {
      text: result.text,
      language: detectedLanguage,
    };
  } catch (error) {
    return {
      error: "Voice transcription failed",
      code: "SERVICE_ERROR",
      details: error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }
}
