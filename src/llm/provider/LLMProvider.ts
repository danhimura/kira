export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Set on role "tool" messages to correlate with the assistant's tool call. */
  toolCallId?: string;
  /** Set on role "tool" messages - the tool name that produced this content. */
  name?: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export interface LLMChatResult {
  content?: string;
  toolCalls?: ToolCallRequest[];
}

/**
 * Section 7 - the LLM provider only ever proposes intent/tool calls. It has
 * no path to the OS other than through the ToolExecutor (R1). Substitutable
 * per R7 - Ollama today, anything else tomorrow.
 */
export interface LLMProvider {
  chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<LLMChatResult>;
}
