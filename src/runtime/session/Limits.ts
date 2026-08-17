// Section 31 - deterministic execution limits. Hitting one ends the turn
// with LIMIT_REACHED; the runtime never continues indefinitely (R3).
export interface SessionLimits {
  /** Max planning/re-planning cycles within a single turn. */
  maxSteps: number;
  /** Max total tool executions within a single turn, across all cycles. */
  maxToolCalls: number;
  /** Max consecutive identical (name + arguments) tool calls tolerated before aborting as a stuck loop. */
  maxSameToolRetries: number;
  /** Wall-clock budget for a single turn. */
  maxExecutionTimeMs: number;
  /** Max characters of a single tool result serialized back into conversation history (large payloads like search_files' 200 paths would otherwise blow the LLM's context window). */
  maxToolResultChars: number;
}

export const DEFAULT_LIMITS: SessionLimits = {
  maxSteps: 3,
  maxToolCalls: 8,
  maxSameToolRetries: 2,
  maxExecutionTimeMs: 60_000,
  maxToolResultChars: 2_000,
};
