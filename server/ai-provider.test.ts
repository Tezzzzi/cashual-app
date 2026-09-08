import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as provider from "./_core/ai-provider";
import { buildChatRequest } from "./_core/openai-llm";
import { buildSttForm } from "./_core/openai-whisper";

/**
 * ai-provider.ts reads process.env on every call, so a test only has to set
 * variables — no module reloading needed. That laziness is deliberate: a key
 * added in the deployment platform also takes effect without a restart.
 */
async function load(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return { ...provider, buildChatRequest, buildSttForm };
}

const AI_KEYS = [
  "XAI_API_KEY", "XAI_CHAT_MODEL", "FORGE_CHAT_MODEL",
  "BUILT_IN_FORGE_API_URL", "BUILT_IN_FORGE_API_KEY",
  "AI_PROVIDER_DEFAULT", "AI_PROVIDER_STT", "AI_PROVIDER_CHAT", "AI_PROVIDER_VISION",
];

const BOTH = {
  XAI_API_KEY: "xai-test",
  BUILT_IN_FORGE_API_URL: "https://forge.manus.ai",
  BUILT_IN_FORGE_API_KEY: "forge-test",
};

describe("provider selection", () => {
  beforeEach(() => { for (const k of AI_KEYS) delete process.env[k]; });
  afterEach(() => { for (const k of AI_KEYS) delete process.env[k]; });

  it("defaults to grok when both providers are configured", async () => {
    const ai = await load(BOTH);
    expect(ai.resolveProvider("chat")).toBe("grok");
    expect(ai.resolveProvider("stt")).toBe("grok");
  });

  it("honours an explicit in-app choice", async () => {
    const ai = await load(BOTH);
    expect(ai.resolveProvider("chat", "manus")).toBe("manus");
    expect(ai.resolveProvider("stt", "manus")).toBe("manus");
  });

  it("ignores an unknown provider name rather than failing", async () => {
    const ai = await load(BOTH);
    expect(ai.resolveProvider("chat", "not-a-provider")).toBe("grok");
  });

  it("falls through to the other provider when the chosen one has no key", async () => {
    // Grok requested but unconfigured: degrade instead of erroring.
    const ai = await load({ ...BOTH, XAI_API_KEY: undefined });
    expect(ai.resolveProvider("chat", "grok")).toBe("manus");
  });

  it("applies a per-task default over the global one", async () => {
    const ai = await load({ ...BOTH, AI_PROVIDER_DEFAULT: "grok", AI_PROVIDER_STT: "manus" });
    expect(ai.resolveProvider("stt")).toBe("manus");
    expect(ai.resolveProvider("chat")).toBe("grok");
  });

  it("throws only when no provider is configured at all", async () => {
    const ai = await load({});
    expect(() => ai.resolveProvider("chat")).toThrow(/No AI provider/i);
  });

  it("lists only configured providers for the in-app selector", async () => {
    const ai = await load({ ...BOTH, XAI_API_KEY: undefined });
    expect(ai.availableProviders("chat").map((p: any) => p.id)).toEqual(["manus"]);
  });
});

describe("chat request carries the provider's own model", () => {
  beforeEach(() => { for (const k of AI_KEYS) delete process.env[k]; });
  afterEach(() => { for (const k of AI_KEYS) delete process.env[k]; });

  const params = { messages: [{ role: "user" as const, content: "hi" }] };

  it("sends a grok model to the xAI endpoint", async () => {
    const ai = await load(BOTH);
    const req = ai.buildChatRequest(params, "chat", "grok");
    expect(req.url).toBe("https://api.x.ai/v1/chat/completions");
    expect(String(req.payload.model)).toMatch(/^grok/);
  });

  it("sends a gemini model to the Forge endpoint", async () => {
    const ai = await load(BOTH);
    const req = ai.buildChatRequest(params, "chat", "manus");
    expect(req.url).toBe("https://forge.manus.ai/v1/chat/completions");
    expect(req.payload.model).toBe("gemini-2.5-flash");
  });

  it("never sends one provider's model to the other's endpoint", async () => {
    // Regression guard for the original defect: model was hardcoded to
    // "gemini-2.5-flash" while the URL could switch providers, so the
    // documented OpenAI fallback could only ever return an error.
    const ai = await load(BOTH);
    for (const p of ["grok", "manus"]) {
      const req = ai.buildChatRequest(params, "chat", p);
      const isXai = req.url.includes("api.x.ai");
      const isGrokModel = String(req.payload.model).startsWith("grok");
      expect(isXai).toBe(isGrokModel);
    }
  });

  it("allows overriding a model without a code change", async () => {
    const ai = await load({ ...BOTH, XAI_CHAT_MODEL: "grok-5-future" });
    const req = ai.buildChatRequest(params, "chat", "grok");
    expect(req.payload.model).toBe("grok-5-future");
  });
});

describe("speech dialects", () => {
  beforeEach(() => { for (const k of AI_KEYS) delete process.env[k]; });
  afterEach(() => { for (const k of AI_KEYS) delete process.env[k]; });

  const options = { audioBuffer: Buffer.from("fake audio"), language: "ru", mimeType: "audio/webm" };

  it("omits model for xAI and puts file last", async () => {
    const ai = await load(BOTH);
    const form = ai.buildSttForm(options, "xai", null);
    // xAI's /v1/stt rejects `model`, and its docs require options before `file`.
    expect(form.get("model")).toBeNull();
    const keys = [...form.keys()];
    expect(keys[keys.length - 1]).toBe("file");
    expect(form.get("language")).toBe("ru");
  });

  it("sends model and prompt for the Whisper dialect", async () => {
    const ai = await load(BOTH);
    const form = ai.buildSttForm(options, "openai", "whisper-1");
    expect(form.get("model")).toBe("whisper-1");
    expect(String(form.get("prompt"))).toMatch(/транзакция/);
  });

  it("routes Azerbaijani away from grok, which does not list it", async () => {
    const ai = await load(BOTH);
    expect(ai.supportsSttLanguage("grok", "az")).toBe(false);
    expect(ai.supportsSttLanguage("grok", "ru")).toBe(true);
    expect(ai.supportsSttLanguage("manus", "az")).toBe(true);
  });

  it("treats language codes case-insensitively", async () => {
    const ai = await load(BOTH);
    expect(ai.supportsSttLanguage("grok", "RU")).toBe(true);
  });
});
