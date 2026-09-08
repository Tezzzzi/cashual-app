import {
  isConfigured,
  PROVIDERS,
  resolveProvider,
  sttEndpoint,
  supportsSttLanguage,
  type Provider,
} from "./ai-provider";

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
 * Assemble the multipart body for a provider's speech endpoint.
 *
 * The two dialects differ in more than the URL:
 *  - openai/Forge: `model` is required, `prompt` biases recognition, field order
 *    is irrelevant.
 *  - xAI /v1/stt: takes **no** `model` field, has no `prompt` (it uses repeatable
 *    `keyterm` instead), and its docs require every option field to precede
 *    `file` in the body. FormData preserves append order, so `file` goes last.
 *
 * Exported for tests: the field set and ordering are the part most likely to
 * break silently against a live endpoint.
 */
export function buildSttForm(
  options: TranscribeOptions,
  dialect: "xai" | "openai",
  model: string | null
): FormData {
  const formData = new FormData();
  const mimeType = options.mimeType || "audio/webm";
  const ext = getFileExtension(mimeType);
  const audioBlob = new Blob([new Uint8Array(options.audioBuffer)], { type: mimeType });

  if (dialect === "xai") {
    if (options.language) {
      formData.append("language", options.language);
      // Inverse text normalization ("сто манат" → "100 AZN") needs `language`.
      formData.append("format", "true");
    }
    for (const term of ["manat", "AZN", "EUR", "USD"]) {
      formData.append("keyterm", term);
    }
    formData.append("file", audioBlob, `audio.${ext}`); // must be last
    return formData;
  }

  formData.append("file", audioBlob, `audio.${ext}`);
  if (model) formData.append("model", model);
  if (options.language) formData.append("language", options.language);
  formData.append(
    "prompt",
    options.language === "ru"
      ? "Это финансовая транзакция. Распознай сумму, категорию и описание."
      : options.language === "az"
        ? "Bu maliyyə əməliyyatıdır. Məbləğ, kateqoriya və təsviri tanı."
        : "This is a financial transaction. Recognize the amount, category, and description."
  );
  return formData;
}

/**
 * Transcribe audio. `requested` carries the user's in-app provider choice.
 *
 * Azerbaijani is not among the 25 languages xAI documents for speech, so an
 * `az` request is routed to a provider that covers it rather than silently
 * degrading. See supportsSttLanguage in ai-provider.ts.
 */
export async function transcribeAudio(
  options: TranscribeOptions,
  requested?: string | null
): Promise<WhisperResponse | TranscriptionError> {
  try {
    let provider: Provider;
    try {
      provider = resolveProvider("stt", requested);
      if (!supportsSttLanguage(provider, options.language)) {
        const alternative = PROVIDERS.find(
          (p) => p !== provider && isConfigured(p, "stt") && supportsSttLanguage(p, options.language)
        );
        if (alternative) {
          console.log(
            `[STT] ${provider} does not list "${options.language}"; using ${alternative} instead`
          );
          provider = alternative;
        }
      }
    } catch {
      console.error("[STT] No speech provider configured");
      return {
        error: "Transcription service is not configured",
        code: "SERVICE_ERROR",
        details: "No AI provider has speech credentials configured",
      };
    }

    const { url: apiUrl, model, dialect, apiKey } = sttEndpoint(provider);

    // Check file size (16MB limit)
    const sizeMB = options.audioBuffer.length / (1024 * 1024);
    if (sizeMB > 16) {
      return {
        error: "Audio file exceeds maximum size limit",
        code: "FILE_TOO_LARGE",
        details: `File size is ${sizeMB.toFixed(2)}MB, maximum allowed is 16MB`,
      };
    }

    console.log(
      `[STT] provider=${provider} dialect=${dialect} size=${sizeMB.toFixed(2)}MB url=${apiUrl}`
    );

    const formData = buildSttForm(options, dialect, model);

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

    // Both dialects return { text, language }. xAI adds duration/words, which
    // are ignored, and reports language as BCP-47 ("es-mx"), so keep only the
    // primary subtag — the rest of the app works with "ru"/"az"/"en".
    const result = (await response.json()) as { text: string; language?: string };
    console.log(`[STT] provider=${provider} text="${result.text.substring(0, 50)}..."`);

    const detectedLanguage = normalizeLanguageTag(result.language) || options.language || "ru";

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

/** "es-mx" → "es"; empty/undefined stays empty so callers can fall back. */
export function normalizeLanguageTag(tag?: string): string {
  if (!tag) return "";
  return tag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
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
