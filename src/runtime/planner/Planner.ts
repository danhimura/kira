import { z } from "zod";
import type { LLMProvider } from "../../llm/provider/LLMProvider.js";
import { structuredCall } from "../../llm/schemas/structuredCall.js";
import type { Intent } from "../intent/IntentProcessor.js";
import type { Observation } from "../observation/ObservationManager.js";

// Section 8 - the plan is provisional. Re-planning after each observation is
// the normal path, not an exception.
export const PlanSchema = z.object({
  steps: z.array(z.string()).min(1).describe("Ordered, short natural-language steps to achieve the goal."),
});
export type Plan = z.infer<typeof PlanSchema>;

const SYSTEM = `Você é o planejador de um agente. Dado um objetivo, as ferramentas disponíveis e, se houver, observações reais de tentativas anteriores nesta mesma rodada, produza um plano curto (1 a 4 passos). Se houver observações anteriores, revise o plano à luz delas - não repita uma abordagem que já falhou. Chame SEMPRE emit_plan.`;

export class Planner {
  constructor(private readonly llm: LLMProvider) {}

  async plan(intent: Intent, toolNames: string[], priorObservations: Observation[] = []): Promise<Plan> {
    const context = [
      `Objetivo: ${intent.goal}`,
      intent.target ? `Alvo: ${intent.target}` : "",
      intent.constraints.length ? `Restrições: ${intent.constraints.join("; ")}` : "",
      `Ferramentas disponíveis: ${toolNames.join(", ")}`,
      priorObservations.length
        ? `Observações de tentativas anteriores nesta rodada:\n${priorObservations
            .map((o) => `- [${o.status}] ${o.summary}`)
            .join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const plan = await structuredCall(
      this.llm,
      SYSTEM,
      context,
      "emit_plan",
      "Registra o plano de passos para atingir o objetivo.",
      PlanSchema
    );

    return plan ?? { steps: [intent.goal] };
  }
}
