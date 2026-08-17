import { randomUUID } from "node:crypto";
import type { ChatMessage, LLMChatResult, LLMProvider, ToolSpec } from "../provider/LLMProvider.js";

interface OllamaChatResponse {
  message?: {
    content?: string;
    tool_calls?: Array<{ function: { name: string; arguments: unknown } }>;
  };
  error?: string;
}

export interface OllamaProviderOptions {
  host?: string;
  model: string;
  /** Context window (tokens) requested per call. Ollama defaults to 4096 if unset, which our tool schemas + conversation history can exceed. */
  numCtx?: number;
}

const DEFAULT_NUM_CTX = 16_384;

/**
 * OLLAMA_HOST is commonly set as a bind address ("0.0.0.0:11434", no scheme)
 * for the Ollama server itself - not a valid client target. Normalize it
 * into a dialable URL so the same env var works for both.
 */
function normalizeHost(host: string): string {
  const withScheme = /^[a-z]+:\/\//i.test(host) ? host : `http://${host}`;
  return withScheme.replace("://0.0.0.0", "://127.0.0.1");
}

/**
 * Thin adapter over Ollama's /api/chat. Kept dumb on purpose - all planning/
 * policy/evaluation logic lives in the runtime, not here (R7 substitutable).
 */
export class OllamaProvider implements LLMProvider {
  private readonly host: string;
  private readonly model: string;
  private readonly numCtx: number;

  constructor(options: OllamaProviderOptions) {
    this.host = normalizeHost(options.host ?? "http://localhost:11434");
    this.model = options.model;
    this.numCtx = options.numCtx ?? DEFAULT_NUM_CTX;
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<LLMChatResult> {
    const response = await fetch(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        think: false,
        options: { num_ctx: this.numCtx },
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
      throw new Error(`Ollama request failed (${response.status}): ${body || response.statusText}`);
    }

    const data = (await response.json()) as OllamaChatResponse;
    if (data.error) {
      throw new Error(`Ollama error: ${data.error}`);
    }

    const toolCalls = data.message?.tool_calls?.map((call) => ({
      id: randomUUID().slice(0, 8),
      name: call.function.name,
      arguments: call.function.arguments,
    }));

    return {
      content: data.message?.content,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
    };
  }
}
