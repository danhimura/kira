import { randomUUID } from "node:crypto";
import type { ToolRegistry } from "../../tools/registry/ToolRegistry.js";
import type { EventBus } from "../events/EventBus.js";
import type { Trace } from "../../telemetry/tracing/Trace.js";

export type ToolResult =
  | { status: "SUCCESS"; tool: string; executionId: string; durationMs: number; data: unknown }
  | { status: "FAILURE"; tool: string; executionId: string; durationMs: number; error: { code: string; message: string } }
  | { status: "UNKNOWN"; tool: string; executionId: string; durationMs: number; reason: "TIMEOUT" };

/**
 * Section 9/13 - the only path from a tool_request to an actual Windows-level
 * effect. Schema validation and the risk gate happen here in code (R3), not
 * in the LLM.
 *
 * The gate below is a permissive stand-in for the real Policy Engine
 * (section 9, scheduled for Sprint 3 - see runtime/policy/.sprint). It still
 * enforces the Sprint 1 invariant that only read-only tools may execute
 * without a human in the loop; everything else comes back BLOCKED rather
 * than silently running.
 */
function policyGate(riskLevel: string): "ALLOW" | "BLOCKED" {
  return riskLevel === "read_only" ? "ALLOW" : "BLOCKED";
}

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly events: EventBus,
    private readonly sessionId: string
  ) {}

  async run(toolName: string, rawArgs: unknown, trace: Trace): Promise<ToolResult> {
    const executionId = randomUUID().slice(0, 8);
    const startedAt = Date.now();
    const emit = (name: Parameters<EventBus["emit"]>[0], data: unknown) =>
      this.events.emit(name, this.sessionId, data);

    emit("tool.requested", { tool: toolName, executionId, args: rawArgs });
    trace.record("TOOL_REQUEST", { tool: toolName, args: rawArgs });

    const tool = this.registry.get(toolName);
    if (!tool) {
      trace.record("TOOL_FAILED", { tool: toolName, code: "TOOL_NOT_FOUND" });
      emit("tool.failed", { tool: toolName, executionId, code: "TOOL_NOT_FOUND" });
      return {
        status: "FAILURE",
        tool: toolName,
        executionId,
        durationMs: Date.now() - startedAt,
        error: { code: "TOOL_NOT_FOUND", message: `No such tool: ${toolName}` },
      };
    }

    const decision = policyGate(tool.riskLevel);
    if (decision === "BLOCKED") {
      trace.record("POLICY_DENY", { tool: toolName, riskLevel: tool.riskLevel });
      emit("tool.failed", { tool: toolName, executionId, code: "POLICY_DENIED" });
      return {
        status: "FAILURE",
        tool: toolName,
        executionId,
        durationMs: Date.now() - startedAt,
        error: {
          code: "POLICY_DENIED",
          message: `Tool '${toolName}' requires the Policy Engine (Sprint 3) - only read_only tools run in Sprint 1.`,
        },
      };
    }

    const parsed = tool.inputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      trace.record("TOOL_FAILED", { tool: toolName, code: "VALIDATION_ERROR" });
      emit("tool.failed", { tool: toolName, executionId, code: "VALIDATION_ERROR" });
      return {
        status: "FAILURE",
        tool: toolName,
        executionId,
        durationMs: Date.now() - startedAt,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message },
      };
    }

    trace.record("TOOL_STARTED", { tool: toolName, executionId });
    emit("tool.started", { tool: toolName, executionId });

    const timeout = new Promise<"TIMEOUT">((resolve) =>
      setTimeout(() => resolve("TIMEOUT"), tool.timeoutMs)
    );

    try {
      const outcome = await Promise.race([tool.execute(parsed.data), timeout]);
      const durationMs = Date.now() - startedAt;

      if (outcome === "TIMEOUT") {
        trace.record("TOOL_TIMEOUT", { tool: toolName, executionId });
        emit("tool.timeout", { tool: toolName, executionId });
        return { status: "UNKNOWN", tool: toolName, executionId, durationMs, reason: "TIMEOUT" };
      }

      trace.record("TOOL_COMPLETED", { tool: toolName, executionId, durationMs });
      emit("tool.completed", { tool: toolName, executionId, durationMs });
      return { status: "SUCCESS", tool: toolName, executionId, durationMs, data: outcome };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      trace.record("TOOL_FAILED", { tool: toolName, executionId, code: "EXECUTION_ERROR" });
      emit("tool.failed", { tool: toolName, executionId, code: "EXECUTION_ERROR" });
      return {
        status: "FAILURE",
        tool: toolName,
        executionId,
        durationMs,
        error: { code: "EXECUTION_ERROR", message },
      };
    }
  }
}
