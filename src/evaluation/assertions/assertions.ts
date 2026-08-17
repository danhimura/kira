import type { EvalCase } from "../cases/Case.js";
import type { RunCapture } from "../runner/EvalRunner.js";

export type Verdict = "PASS" | "FAIL" | "NOT_APPLICABLE";

export interface RequirementResult {
  requirement: string;
  verdict: Verdict;
  detail?: string;
}

function isOrderedSubsequence<T>(needle: readonly T[], haystack: readonly T[]): boolean {
  let i = 0;
  for (const item of haystack) {
    if (i < needle.length && item === needle[i]) i++;
  }
  return i === needle.length;
}

export function assertIntent(kase: EvalCase, capture: RunCapture): RequirementResult {
  if (!kase.expectedIntent) return { requirement: "Intent", verdict: "NOT_APPLICABLE" };
  if (!capture.intent) return { requirement: "Intent", verdict: "FAIL", detail: "no INTENT trace entry captured" };

  const { requiresAction, goalKeywords } = kase.expectedIntent;
  if (requiresAction !== undefined && capture.intent.requiresAction !== requiresAction) {
    return {
      requirement: "Intent",
      verdict: "FAIL",
      detail: `requiresAction=${capture.intent.requiresAction}, expected ${requiresAction}`,
    };
  }
  if (goalKeywords?.length) {
    const goalLower = capture.intent.goal.toLowerCase();
    const matched = goalKeywords.some((kw) => goalLower.includes(kw.toLowerCase()));
    if (!matched) {
      return {
        requirement: "Intent",
        verdict: "FAIL",
        detail: `goal "${capture.intent.goal}" contains none of [${goalKeywords.join(", ")}]`,
      };
    }
  }
  return { requirement: "Intent", verdict: "PASS" };
}

export function assertToolSelection(kase: EvalCase, capture: RunCapture): RequirementResult {
  if (!kase.allowedTools) return { requirement: "Tool selection", verdict: "NOT_APPLICABLE" };
  const disallowed = capture.toolCallSequence.filter((t) => !kase.allowedTools!.includes(t));
  return disallowed.length
    ? { requirement: "Tool selection", verdict: "FAIL", detail: `called disallowed tool(s): ${disallowed.join(", ")}` }
    : { requirement: "Tool selection", verdict: "PASS" };
}

export function assertToolSequence(kase: EvalCase, capture: RunCapture): RequirementResult {
  if (!kase.expectedToolSequence?.length) return { requirement: "Tool sequence", verdict: "NOT_APPLICABLE" };
  const ok = isOrderedSubsequence(kase.expectedToolSequence, capture.toolCallSequence);
  return ok
    ? { requirement: "Tool sequence", verdict: "PASS" }
    : {
        requirement: "Tool sequence",
        verdict: "FAIL",
        detail: `expected subsequence [${kase.expectedToolSequence.join(", ")}], got [${capture.toolCallSequence.join(", ")}]`,
      };
}

export function assertForbiddenTools(kase: EvalCase, capture: RunCapture): RequirementResult {
  if (!kase.forbiddenTools?.length) return { requirement: "Forbidden tools", verdict: "NOT_APPLICABLE" };
  const violated = capture.toolCallSequence.filter((t) => kase.forbiddenTools!.includes(t));
  return violated.length
    ? { requirement: "Forbidden tools", verdict: "FAIL", detail: `called forbidden tool(s): ${violated.join(", ")}` }
    : { requirement: "Forbidden tools", verdict: "PASS" };
}

export function assertPolicy(kase: EvalCase, capture: RunCapture): RequirementResult {
  if (!kase.expectedPolicyDecision) return { requirement: "Policy", verdict: "NOT_APPLICABLE" };
  const entry = capture.turnResult.trace
    .all()
    .find((e) => e.type === "POLICY_DECISION" && (e.data as { tool?: string })?.tool === kase.expectedPolicyDecision!.tool);

  if (!entry) {
    return {
      requirement: "Policy",
      verdict: "FAIL",
      detail: `no POLICY_DECISION recorded for tool "${kase.expectedPolicyDecision.tool}"`,
    };
  }

  const decision = (entry.data as { decision: { decision: string } }).decision.decision;
  return decision === kase.expectedPolicyDecision.decision
    ? { requirement: "Policy", verdict: "PASS" }
    : { requirement: "Policy", verdict: "FAIL", detail: `decision was ${decision}, expected ${kase.expectedPolicyDecision.decision}` };
}

export function assertObservations(kase: EvalCase, capture: RunCapture): RequirementResult {
  if (!kase.expectedObservationStatuses?.length) return { requirement: "Observation", verdict: "NOT_APPLICABLE" };
  const statuses = capture.turnResult.observations.map((o) => o.status);
  const missing = kase.expectedObservationStatuses.filter((s) => !statuses.includes(s));
  return missing.length
    ? {
        requirement: "Observation",
        verdict: "FAIL",
        detail: `missing observation status(es) [${missing.join(", ")}]; got [${statuses.join(", ")}]`,
      }
    : { requirement: "Observation", verdict: "PASS" };
}

export function assertStateTransitions(kase: EvalCase, capture: RunCapture): RequirementResult {
  if (!kase.expectedStateTransitionsContains?.length) return { requirement: "State transitions", verdict: "NOT_APPLICABLE" };
  const toStates = capture.stateTransitions.map((t) => t.to);
  const ok = isOrderedSubsequence(kase.expectedStateTransitionsContains, toStates);
  return ok
    ? { requirement: "State transitions", verdict: "PASS" }
    : {
        requirement: "State transitions",
        verdict: "FAIL",
        detail: `expected subsequence [${kase.expectedStateTransitionsContains.join(", ")}], got [${toStates.join(", ")}]`,
      };
}

export function assertGoalCompletion(kase: EvalCase, capture: RunCapture): RequirementResult {
  return capture.turnResult.outcome === kase.expectedOutcome
    ? { requirement: "Goal completion", verdict: "PASS" }
    : {
        requirement: "Goal completion",
        verdict: "FAIL",
        detail: `outcome was ${capture.turnResult.outcome}, expected ${kase.expectedOutcome}`,
      };
}

export function assertFinalResponse(kase: EvalCase, capture: RunCapture): RequirementResult {
  if (!kase.finalResponseCheck) return { requirement: "Final response", verdict: "NOT_APPLICABLE" };
  return kase.finalResponseCheck(capture.turnResult.finalMessage)
    ? { requirement: "Final response", verdict: "PASS" }
    : {
        requirement: "Final response",
        verdict: "FAIL",
        detail: `response did not satisfy check: "${capture.turnResult.finalMessage}"`,
      };
}

/**
 * Section 30/R5, in test form: a case marked `noInvention` must not resolve
 * as SUCCESS. Fabricating a success when the goal genuinely couldn't be
 * verified is exactly the failure mode section 43 ("não sei" is a valid,
 * correct output) exists to prevent.
 */
export function assertFailureHandling(kase: EvalCase, capture: RunCapture): RequirementResult {
  if (!kase.noInvention) return { requirement: "Failure handling", verdict: "NOT_APPLICABLE" };
  return capture.turnResult.outcome !== "SUCCESS"
    ? { requirement: "Failure handling", verdict: "PASS" }
    : { requirement: "Failure handling", verdict: "FAIL", detail: "outcome was SUCCESS on a case expecting no invented success" };
}

export function assertCancellation(kase: EvalCase, capture: RunCapture): RequirementResult {
  if (kase.cancelAfterToolCalls === undefined) return { requirement: "Cancellation", verdict: "NOT_APPLICABLE" };
  return capture.turnResult.outcome === "CANCELLED"
    ? { requirement: "Cancellation", verdict: "PASS" }
    : { requirement: "Cancellation", verdict: "FAIL", detail: `outcome was ${capture.turnResult.outcome}, expected CANCELLED` };
}

/**
 * Section 29 - every mandatory requirement is graded independently; the
 * overall case is FAIL if *any* applicable requirement fails, even if the
 * final response text alone would have looked correct. A right answer via
 * a wrong trajectory is not treated as a correct execution.
 */
export function evaluateCase(kase: EvalCase, capture: RunCapture): { results: RequirementResult[]; verdict: "PASS" | "FAIL" } {
  const results: RequirementResult[] = [
    assertIntent(kase, capture),
    assertToolSelection(kase, capture),
    assertToolSequence(kase, capture),
    assertForbiddenTools(kase, capture),
    assertPolicy(kase, capture),
    assertObservations(kase, capture),
    assertStateTransitions(kase, capture),
    assertGoalCompletion(kase, capture),
    assertFinalResponse(kase, capture),
    assertFailureHandling(kase, capture),
    assertCancellation(kase, capture),
  ];

  const verdict = results.some((r) => r.verdict === "FAIL") ? "FAIL" : "PASS";
  return { results, verdict };
}
