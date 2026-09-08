/**
 * Two independent AI providers, selectable per task so their quality can be
 * compared on real input.
 *
 * `grok`  — xAI. Chat/vision is OpenAI-compatible; speech-to-text is NOT: it
 *           lives at /v1/stt, takes no `model` field, requires option fields to
 *           precede `file` in the multipart body, and returns a richer object.
 * `manus` — the Forge gateway (Whisper for speech, Gemini for text/vision).
 *
 * The previous code hardcoded `model: "gemini-2.5-flash"` while claiming to fall
 * back to OpenAI. That fallback could never work — OpenAI has no such model and
 * would reject every request. Models therefore belong to the provider, never to
 * the call site.
 */

export type Provider = "grok" | "manus";
export type Task = "stt" | "chat" | "vision";

export const PROVIDERS: readonly Provider[] = ["grok", "manus"] as const;

/** Which multipart/response dialect a provider's speech endpoint speaks. */
type SttDialect = "xai" | "openai";

type ProviderSpec = {
  label: string;
  chatUrl: () => string | null;
  chatModel: () => string;
  sttUrl: () => string | null;
  /** null when the endpoint accepts no model field, as xAI's /v1/stt does. */
  sttModel: string | null;
  sttDialect: SttDialect;
  apiKey: () => string;
};

/**
 * Environment is read lazily on every call rather than captured at module load.
 * Beyond making this testable, it means a key or model added in the deployment
 * platform takes effect on the next request instead of needing a restart.
 */
const env = (name: string): string => process.env[name] ?? "";

function forgeBase(): string | null {
  const url = env("BUILT_IN_FORGE_API_URL");
  if (!url) return null;
  return url.endsWith("/") ? url : `${url}/`;
}

const SPECS: Record<Provider, ProviderSpec> = {
  grok: {
    label: "Grok (xAI)",
    chatUrl: () => "https://api.x.ai/v1/chat/completions",
    chatModel: () => env("XAI_CHAT_MODEL") || "grok-4.6",
    sttUrl: () => "https://api.x.ai/v1/stt",
    sttModel: null,
    sttDialect: "xai",
    apiKey: () => env("XAI_API_KEY"),
  },
  manus: {
    label: "Manus (Whisper + Gemini)",
    chatUrl: () => {
      const base = forgeBase();
      return base ? `${base}v1/chat/completions` : null;
    },
    chatModel: () => env("FORGE_CHAT_MODEL") || "gemini-2.5-flash",
    sttUrl: () => {
      const base = forgeBase();
      return base ? `${base}v1/audio/transcriptions` : null;
    },
    sttModel: "whisper-1",
    sttDialect: "openai",
    apiKey: () => env("BUILT_IN_FORGE_API_KEY"),
  },
};

export function providerLabel(p: Provider): string {
  return SPECS[p].label;
}

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

/** True when the provider has both a key and an endpoint for the task. */
export function isConfigured(p: Provider, task: Task): boolean {
  const spec = SPECS[p];
  if (!spec.apiKey()) return false;
  return (task === "stt" ? spec.sttUrl() : spec.chatUrl()) !== null;
}

/**
 * Resolve which provider handles a task.
 *
 * Order: explicit request (a user's in-app choice) → per-task env default →
 * global env default → first configured provider. An explicitly requested
 * provider that is not configured falls through rather than failing the request,
 * so a missing key degrades to the other provider instead of an outage.
 */
export function resolveProvider(task: Task, requested?: string | null): Provider {
  const candidates: Array<string | undefined> = [
    requested ?? undefined,
    env(`AI_PROVIDER_${task.toUpperCase()}`),
    env("AI_PROVIDER_DEFAULT"),
    "grok",
  ];

  for (const candidate of candidates) {
    if (isProvider(candidate) && isConfigured(candidate, task)) return candidate;
  }
  // Nothing preferred is usable — take anything that is.
  const fallback = PROVIDERS.find((p) => isConfigured(p, task));
  if (!fallback) {
    throw new Error(`No AI provider configured for task "${task}"`);
  }
  return fallback;
}

export function chatEndpoint(p: Provider): { url: string; model: string; apiKey: string } {
  const spec = SPECS[p];
  const url = spec.chatUrl();
  const apiKey = spec.apiKey();
  if (!url || !apiKey) throw new Error(`Provider "${p}" is not configured for chat`);
  return { url, model: spec.chatModel(), apiKey };
}

export function sttEndpoint(p: Provider): {
  url: string;
  model: string | null;
  dialect: SttDialect;
  apiKey: string;
} {
  const spec = SPECS[p];
  const url = spec.sttUrl();
  const apiKey = spec.apiKey();
  if (!url || !apiKey) throw new Error(`Provider "${p}" is not configured for speech`);
  return { url, model: spec.sttModel, dialect: spec.sttDialect, apiKey };
}

/**
 * Languages a provider's speech endpoint officially supports.
 *
 * xAI documents 25 languages and Azerbaijani is not among them, while the app
 * must keep working in ru/az/en. Callers can use this to route `az` to a
 * provider that handles it instead of silently degrading transcription quality.
 */
const STT_LANGUAGES: Record<Provider, readonly string[] | "unknown"> = {
  grok: [
    "ar", "cs", "da", "nl", "en", "fil", "fr", "de", "hi", "id", "it", "ja",
    "ko", "mk", "ms", "fa", "pl", "pt", "ro", "ru", "es", "sv", "th", "tr", "vi",
  ],
  manus: "unknown", // Whisper covers az; Forge does not publish a list.
};

export function supportsSttLanguage(p: Provider, language?: string): boolean {
  const list = STT_LANGUAGES[p];
  if (list === "unknown" || !language) return true;
  return list.includes(language.toLowerCase());
}

/** Providers usable for a task right now, for the in-app selector. */
export function availableProviders(task: Task): Array<{ id: Provider; label: string }> {
  return PROVIDERS.filter((p) => isConfigured(p, task)).map((p) => ({
    id: p,
    label: SPECS[p].label,
  }));
}
