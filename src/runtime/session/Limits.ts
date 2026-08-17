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
}

export const DEFAULT_LIMITS: SessionLimits = {
  maxSteps: 3,
  maxToolCalls: 8,
  maxSameToolRetries: 2,
  maxExecutionTimeMs: 60_000,
};
