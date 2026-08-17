import type { ChatMessage, LLMChatResult, LLMProvider, ToolSpec } from "../provider/LLMProvider.js";

interface OpenAICompatibleChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
  error?: { message: string };
}

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  /** Shown in error messages (e.g. "DeepSeek", "Groq") - purely cosmetic. */
  label?: string;
}

/**
 * Provider for any API implementing the OpenAI chat-completions shape -
 * DeepSeek, Groq, and others all match it closely enough to share this one
 * implementation. Same LLMProvider interface as OllamaProvider (R7
 * substitutable) - the Agent Runtime doesn't know or care which one it's
 * talking to. Unlike Ollama, tool call arguments come back as a JSON
 * *string*, not an object, so they're parsed here to match
 * ToolCallRequest's shape.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly label: string;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = options.baseUrl;
    this.label = options.label ?? "OpenAI-compatible API";
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<LLMChatResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
          ...(m.name ? { name: m.name } : {}),
        })),
        ...(tools.length ? { tools } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`${this.label} request failed (${response.status}): ${body || response.statusText}`);
    }

    const data = (await response.json()) as OpenAICompatibleChatResponse;
    if (data.error) {
      throw new Error(`${this.label} error: ${data.error.message}`);
    }

    const message = data.choices?.[0]?.message;
    const toolCalls = message?.tool_calls?.map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: safeParseJson(call.function.arguments),
    }));

    return {
      content: message?.content ?? undefined,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
    };
  }
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
