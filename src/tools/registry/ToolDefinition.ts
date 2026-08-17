import type { z } from "zod";

// Section 10/11 - formal tool contract. The LLM only ever sees name +
// description + input_schema (via ToolRegistry.describeForLlm); everything
// else here is consumed by the deterministic Policy Engine / Tool Executor.
export type RiskLevel = "read_only" | "reversible" | "persistent" | "destructive";

export type SideEffects = "none" | "reversible" | "persistent" | "destructive";

export type Idempotency = "yes" | "no" | "partial" | "depends";

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  version: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
  riskLevel: RiskLevel;
  permissions: string[];
  timeoutMs: number;
  cancellable: boolean;
  idempotency: Idempotency;
  sideEffects: SideEffects;
  confirmationPolicy: "none" | "required" | "risk_based";
  environment: "windows" | "cross-platform";
  /** signal fires when the Interrupt Manager (section 32) cancels the turn; tools with cancellable: true should honor it where practical. */
  execute: (input: TInput, signal: AbortSignal) => Promise<TOutput>;
}
