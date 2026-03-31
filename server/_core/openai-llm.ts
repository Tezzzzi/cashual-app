import { ENV } from "./env";

export type Role = "system" | "user" | "assistant";

export type Message = {
  role: Role;
  content: string;
};

export type InvokeParams = {
  messages: Message[];
  response_format?: {
    type: "json_schema";
    json_schema: {
      name: string;
      schema: Record<string, unknown>;
      strict?: boolean;
    };
  };
};

export type InvokeResult = {
  id: string;
  choices: Array<{
    message: {
      role: Role;
      content: string;
    };
  }>;
};

/**
 * Get the LLM API URL - prefer Forge API, fall back to OpenAI
 */
function getLLMApiUrl(): string {
  if (ENV.forgeApiUrl && ENV.forgeApiKey) {
    const baseUrl = ENV.forgeApiUrl.endsWith("/") ? ENV.forgeApiUrl : `${ENV.forgeApiUrl}/`;
    return `${baseUrl}v1/chat/completions`;
  }
  return "https://api.openai.com/v1/chat/completions";
}

/**
 * Get the API key - prefer Forge API key, fall back to OpenAI key
 */
function getLLMApiKey(): string | null {
  if (ENV.forgeApiUrl && ENV.forgeApiKey) {
    return ENV.forgeApiKey;
  }
  if (ENV.openaiApiKey) {
    return ENV.openaiApiKey;
  }
  return null;
}

/**
 * Call LLM API - uses Forge API if available, falls back to OpenAI
 */
export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const apiKey = getLLMApiKey();
  const apiUrl = getLLMApiUrl();

  if (!apiKey) {
    console.error("[LLM] No API credentials available. forgeApiUrl:", !!ENV.forgeApiUrl, "forgeApiKey:", !!ENV.forgeApiKey, "openaiApiKey:", !!ENV.openaiApiKey);
    throw new Error("No LLM API credentials configured (neither BUILT_IN_FORGE_API_KEY nor OPENAI_API_KEY)");
  }

  console.log(`[LLM] Calling ${apiUrl}`);

  const payload: Record<string, unknown> = {
    model: "gemini-2.5-flash",
    messages: params.messages,
    max_tokens: 4096,
  };

  if (params.response_format) {
    payload.response_format = params.response_format;
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[LLM] API error: ${response.status} ${response.statusText} – ${errorText}`);
    throw new Error(
      `LLM API error: ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  const result = (await response.json()) as InvokeResult;
  console.log(`[LLM] Success, response length: ${result.choices?.[0]?.message?.content?.length || 0}`);
  return result;
}
