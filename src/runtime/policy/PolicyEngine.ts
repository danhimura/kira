import type { ToolDefinition } from "../../tools/registry/ToolDefinition.js";

export type PolicyDecision =
  | { decision: "ALLOW" }
  | { decision: "DENY"; reason: string }
  | { decision: "REQUIRE_CONFIRMATION"; reason: string };

export interface PolicyContext {
  /** Tool names the user has already approved once this session - persistent-risk tools aren't re-prompted every single call. */
  approvedThisSession: ReadonlySet<string>;
}

/**
 * Section 9 - the only place a tool_request is judged ALLOW/DENY/
 * REQUIRE_CONFIRMATION. Deterministic (R3): risk_level + confirmationPolicy
 * + environment compatibility decide the outcome - the LLM cannot alter it,
 * and (R1) nothing downstream of this decision has authority to override it.
 */
export class PolicyEngine {
  decide(tool: ToolDefinition<any, any>, ctx: PolicyContext): PolicyDecision {
    if (tool.environment === "windows" && process.platform !== "win32") {
      return { decision: "DENY", reason: "environment_mismatch" };
    }

    if (tool.confirmationPolicy === "none") {
      return { decision: "ALLOW" };
    }

    if (tool.confirmationPolicy === "required") {
      return { decision: "REQUIRE_CONFIRMATION", reason: "tool_requires_explicit_confirmation" };
    }

    // confirmationPolicy === "risk_based"
    switch (tool.riskLevel) {
      case "read_only":
        return { decision: "ALLOW" };

      case "reversible":
        return ctx.approvedThisSession.has(tool.name)
          ? { decision: "ALLOW" }
          : { decision: "REQUIRE_CONFIRMATION", reason: "operation_has_reversible_side_effect" };

      case "persistent":
        return ctx.approvedThisSession.has(tool.name)
          ? { decision: "ALLOW" }
          : { decision: "REQUIRE_CONFIRMATION", reason: "operation_has_persistent_side_effect" };

      case "destructive":
        // Never cached - section 11.4 destructive tools confirm every time.
        return { decision: "REQUIRE_CONFIRMATION", reason: "operation_is_destructive" };

      default:
        return { decision: "DENY", reason: "unknown_risk_level" };
    }
  }
}
