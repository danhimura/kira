import { randomUUID } from "node:crypto";
import type { ToolRegistry } from "../../tools/registry/ToolRegistry.js";
import type { EventBus } from "../events/EventBus.js";
import type { Trace } from "../../telemetry/tracing/Trace.js";
import type { InterruptManager } from "../interrupt/InterruptManager.js";

export type ToolResult =
  | { status: "SUCCESS"; tool: string; executionId: string; durationMs: number; data: unknown }
  | { status: "FAILURE"; tool: string; executionId: string; durationMs: number; error: { code: string; message: string } }
  | { status: "UNKNOWN"; tool: string; executionId: string; durationMs: number; reason: "TIMEOUT" };

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Section 9/13 - the only path from a tool_request to an actual Windows-level
 * effect. Schema validation happens here in code (R3). Risk authorization
 * (ALLOW/DENY/REQUIRE_CONFIRMATION) is decided by the caller's PolicyEngine
 * *before* run() is invoked (see main.ts) - this executor trusts that
 * decision and focuses purely on mechanical execution, timeout, and
 * cancellation (section 32).
 */
export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly events: EventBus,
    private readonly sessionId: string
  ) {}

  async run(toolName: string, rawArgs: unknown, trace: Trace, interrupt: InterruptManager): Promise<ToolResult> {
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

    if (interrupt.isCancelRequested()) {
      return this.reject(toolName, "CANCELLED", "Cancelled before execution started.", trace);
    }

    trace.record("TOOL_STARTED", { tool: toolName, executionId });
    emit("tool.started", { tool: toolName, executionId });

    const timeout = new Promise<"TIMEOUT">((resolve) =>
      setTimeout(() => resolve("TIMEOUT"), tool.timeoutMs)
    );

    try {
      const outcome = await Promise.race([tool.execute(parsed.data, interrupt.signal), timeout]);
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
      const code = isAbortError(err) ? "CANCELLED" : "EXECUTION_ERROR";
      const message = isAbortError(err)
        ? "Cancelled while running."
        : err instanceof Error
          ? err.message
          : String(err);
      trace.record("TOOL_FAILED", { tool: toolName, executionId, code });
      emit("tool.failed", { tool: toolName, executionId, code });
      return { status: "FAILURE", tool: toolName, executionId, durationMs, error: { code, message } };
    }
  }

  /**
   * Used by the caller when the Policy Engine already decided DENY, or the
   * user declined a confirmation prompt - the tool never runs, but this
   * still produces a canonical ToolResult with the same trace/event trail
   * as a real execution, so the Observation Manager and Goal Evaluator see
   * a normal FAILURE rather than a special case.
   */
  reject(toolName: string, code: string, message: string, trace: Trace): ToolResult {
    const executionId = randomUUID().slice(0, 8);
    trace.record("TOOL_FAILED", { tool: toolName, executionId, code });
    this.events.emit("tool.failed", this.sessionId, { tool: toolName, executionId, code });
    return {
      status: "FAILURE",
      tool: toolName,
      executionId,
      durationMs: 0,
      error: { code, message },
    };
  }
}
