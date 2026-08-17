import type { AgentState } from "../../runtime/state/StateMachine.js";
import type { TurnOutcome } from "../../runtime/AgentRuntime.js";

/**
 * Section 28 - a test case for the Evaluation Harness. Every field is
 * optional except `input` and `expectedOutcome`: a case only asserts what
 * it explicitly declares, matching section 28's Case shape without forcing
 * every case to specify every field.
 */
export interface EvalCase {
  id: string;
  description: string;

  /** section 28: input */
  input: string;

  /** section 28: initial_environment - setup run before the case (e.g. remove a leftover test file). */
  setup?: () => Promise<void> | void;

  /** section 28: expected_intent (loose, structural) */
  expectedIntent?: {
    requiresAction?: boolean;
    /** at least one of these must appear (case-insensitive) in the extracted intent's goal */
    goalKeywords?: string[];
  };

  /** section 28: allowed_tools - every tool call made must be in this list */
  allowedTools?: string[];
  /** section 28: expected_tool_sequence - ordered subsequence that must appear (not necessarily contiguous) */
  expectedToolSequence?: string[];
  /** section 28: forbidden_tools - must never be called */
  forbiddenTools?: string[];

  /** asserts a specific Policy Engine decision was recorded for a given tool */
  expectedPolicyDecision?: { tool: string; decision: "ALLOW" | "DENY" | "REQUIRE_CONFIRMATION" };

  /** section 28: expected_observations (loose) - these statuses must each appear at least once */
  expectedObservationStatuses?: Array<"SUCCESS" | "FAILURE" | "UNKNOWN">;

  /** section 28: expected_state_transitions - ordered subsequence of states the FSM must have entered */
  expectedStateTransitionsContains?: AgentState[];

  /** section 28: expected_goal_state */
  expectedOutcome: TurnOutcome;

  /** section 28: expected_final_response */
  finalResponseCheck?: (message: string) => boolean;

  /**
   * section 28: expected_failure_behavior - R5 in test form. When true, the
   * case must NOT resolve as SUCCESS: a fabricated success is exactly the
   * failure mode this guards against (section 30's "não sei" requirement).
   */
  noInvention?: boolean;

  /** How the harness should answer any REQUIRE_CONFIRMATION prompt during this case (default: approve). */
  confirmBehavior?: "approve" | "deny";
  /** Simulates the user cancelling (Ctrl+C) once this many tool calls have completed. */
  cancelAfterToolCalls?: number;

  /** section 28: cleanup - run after the case regardless of pass/fail */
  cleanup?: () => Promise<void> | void;
}
