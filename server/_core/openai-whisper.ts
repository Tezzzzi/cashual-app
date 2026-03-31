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
 * Transcribe audio to text using the Forge API (Whisper-compatible endpoint)
 * Falls back to OpenAI API if OPENAI_API_KEY is set and Forge API is not available.
 */
export async function transcribeAudio(
  options: TranscribeOptions
): Promise<WhisperResponse | TranscriptionError> {
  try {
    // Determine which API to use
    const apiUrl = getTranscriptionApiUrl();
    const apiKey = getTranscriptionApiKey();

    if (!apiUrl || !apiKey) {
      console.error("[Whisper] No API credentials available. forgeApiUrl:", !!ENV.forgeApiUrl, "forgeApiKey:", !!ENV.forgeApiKey, "openaiApiKey:", !!ENV.openaiApiKey);
      return {
        error: "Transcription service is not configured",
        code: "SERVICE_ERROR",
        details: "Neither BUILT_IN_FORGE_API_URL nor OPENAI_API_KEY is set",
      };
    }

    // Check file size (16MB limit)
    const sizeMB = options.audioBuffer.length / (1024 * 1024);
    if (sizeMB > 16) {
      return {
        error: "Audio file exceeds maximum size limit",
        code: "FILE_TOO_LARGE",
        details: `File size is ${sizeMB.toFixed(2)}MB, maximum allowed is 16MB`,
      };
    }

    console.log(`[Whisper] Transcribing ${sizeMB.toFixed(2)}MB audio via ${apiUrl}`);

    // Create FormData for multipart upload
    const formData = new FormData();

    // Convert Buffer to Blob
    const mimeType = options.mimeType || "audio/webm";
    const ext = getFileExtension(mimeType);
    const audioBlob = new Blob([new Uint8Array(options.audioBuffer)], { type: mimeType });
    formData.append("file", audioBlob, `audio.${ext}`);

    formData.append("model", "whisper-1");
    
    if (options.language) {
      formData.append("language", options.language);
    }

    const prompt =
      options.language === "ru"
        ? "Это финансовая транзакция. Распознай сумму, категорию и описание."
        : options.language === "az"
          ? "Bu maliyyə əməliyyatıdır. Məbləğ, kateqoriya və təsviri tanı."
          : "This is a financial transaction. Recognize the amount, category, and description.";

    formData.append("prompt", prompt);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Accept-Encoding": "identity",
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(`[Whisper] API error: ${response.status} ${response.statusText} - ${errorText}`);
      return {
        error: "Transcription service request failed",
        code: "TRANSCRIPTION_FAILED",
        details: `${response.status} ${response.statusText}${errorText ? `: ${errorText}` : ""}`,
      };
    }

    const result = (await response.json()) as { text: string; language?: string };
    console.log(`[Whisper] Transcription successful: "${result.text.substring(0, 50)}..."`);

    // Detect language from the transcription
    const detectedLanguage = result.language || options.language || "ru";

    return {
      text: result.text,
      language: detectedLanguage,
    };
  } catch (error) {
    console.error("[Whisper] Unexpected error:", error);
    return {
      error: "Voice transcription failed",
      code: "SERVICE_ERROR",
      details: error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }
}

/**
 * Get the transcription API URL - prefer Forge API, fall back to OpenAI
 */
function getTranscriptionApiUrl(): string | null {
  if (ENV.forgeApiUrl && ENV.forgeApiKey) {
    const baseUrl = ENV.forgeApiUrl.endsWith("/") ? ENV.forgeApiUrl : `${ENV.forgeApiUrl}/`;
    return `${baseUrl}v1/audio/transcriptions`;
  }
  if (ENV.openaiApiKey) {
    return "https://api.openai.com/v1/audio/transcriptions";
  }
  return null;
}

/**
 * Get the API key - prefer Forge API key, fall back to OpenAI key
 */
function getTranscriptionApiKey(): string | null {
  if (ENV.forgeApiUrl && ENV.forgeApiKey) {
    return ENV.forgeApiKey;
  }
  if (ENV.openaiApiKey) {
    return ENV.openaiApiKey;
  }
  return null;
}

/**
 * Get file extension from MIME type
 */
function getFileExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "audio/webm": "webm",
    "audio/mp3": "mp3",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
    "audio/m4a": "m4a",
    "audio/mp4": "m4a",
  };
  return mimeToExt[mimeType] || "webm";
}
