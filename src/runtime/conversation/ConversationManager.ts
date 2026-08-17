import type { ChatMessage } from "../../llm/provider/LLMProvider.js";

const DEFAULT_MAX_MESSAGES = 40;
const DEFAULT_RECENT_HISTORY_FOR_INTENT = 6;

/**
 * Section 5/24 - owns the session's message history. Sprint 2 keeps it
 * bounded (a lightweight stand-in for section 31's max_context) rather than
 * letting it grow unbounded for the life of a session.
 */
export class ConversationManager {
  constructor(private readonly maxMessages: number = DEFAULT_MAX_MESSAGES) {}

  append(history: ChatMessage[], message: ChatMessage): void {
    history.push(message);
    this.trim(history);
  }

  /** Short serialized tail of the conversation, for components (like the
   * Intent Processor) that need continuity without the full history. */
  recentSummary(history: ChatMessage[], maxMessages: number = DEFAULT_RECENT_HISTORY_FOR_INTENT): string {
    return history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-maxMessages)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");
  }

  private trim(history: ChatMessage[]): void {
    if (history.length <= this.maxMessages) return;
    history.splice(0, history.length - this.maxMessages);
  }
}
