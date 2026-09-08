import {
  chatEndpoint,
  resolveProvider,
  type Provider,
  type Task,
} from "./ai-provider";

export type Role = "system" | "user" | "assistant";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type MessageContent = string | TextContent | ImageContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
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
  max_tokens?: number;
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
 * Build the request for a task, choosing the provider and its model together.
 *
 * Exported for tests: asserting on the built request is the only way to catch
 * a provider/model mismatch without spending money on a live call.
 */
export function buildChatRequest(
  params: InvokeParams,
  task: Task = "chat",
  requested?: string | null
): { url: string; apiKey: string; provider: Provider; payload: Record<string, unknown> } {
  const provider = resolveProvider(task, requested);
  const { url, model, apiKey } = chatEndpoint(provider);

  const payload: Record<string, unknown> = {
    model,
    messages: params.messages,
    max_tokens: params.max_tokens || 4096,
  };

  if (params.response_format) {
    payload.response_format = params.response_format;
  }

  return { url, apiKey, provider, payload };
}

/**
 * Call the chat/vision model. `task` picks the per-task default ("vision" for
 * image input) and `requested` carries the user's in-app choice.
 */
export async function invokeLLM(
  params: InvokeParams,
  task: Task = "chat",
  requested?: string | null
): Promise<InvokeResult> {
  const { url: apiUrl, apiKey, provider, payload } = buildChatRequest(params, task, requested);

  console.log(`[LLM] provider=${provider} model=${payload.model} url=${apiUrl}`);

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
