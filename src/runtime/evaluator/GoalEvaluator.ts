import { z } from "zod";
import type { LLMProvider } from "../../llm/provider/LLMProvider.js";
import { structuredCall } from "../../llm/schemas/structuredCall.js";
import type { Intent } from "../intent/IntentProcessor.js";
import type { Observation } from "../observation/ObservationManager.js";

// Section 15/16 - the question is never "did the last tool call succeed?".
// It's "was the goal actually achieved, given everything observed so far?".
export const EvaluationSchema = z.object({
  verdict: z.enum(["COMPLETE", "REPLAN", "ASK_USER", "FAIL"]),
  rationale: z.string().describe("Brief internal justification for the verdict."),
  userMessage: z
    .string()
    .describe(
      "The exact message to show the user: the answer (COMPLETE), the clarifying question (ASK_USER), or the failure explanation (FAIL/REPLAN)."
    ),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

const SYSTEM = `Você é o avaliador de objetivos de um agente. Você recebe o objetivo original e as observações REAIS coletadas por ferramentas - nunca invente dados que não estejam nelas (regra de falha segura: ausência de informação não deve virar invenção).

Decida se o objetivo foi REALMENTE atingido pelas observações, não apenas se uma ferramenta retornou sucesso.

Vereditos possíveis:
- COMPLETE: as observações (ou a natureza puramente conversacional do pedido) são suficientes para responder ao objetivo agora.
- REPLAN: ainda falta informação, mas vale tentar uma abordagem diferente com as ferramentas disponíveis.
- ASK_USER: o pedido é ambíguo, ou falta uma informação que só o usuário pode fornecer.
- FAIL: o objetivo não pode ser atingido com as ferramentas disponíveis (ex.: ferramenta necessária não existe, aplicativo não encontrado, permissão negada).

Se não houver evidência suficiente e nenhuma ferramenta adicional puder ajudar, prefira responder "não sei" (FAIL com explicação) a adivinhar. Chame SEMPRE emit_evaluation.`;

export class GoalEvaluator {
  constructor(private readonly llm: LLMProvider) {}

  async evaluate(intent: Intent, observations: Observation[], assistantDraft?: string): Promise<Evaluation> {
    const context = [
      `Objetivo: ${intent.goal}`,
      intent.target ? `Alvo: ${intent.target}` : "",
      observations.length
        ? `Observações:\n${observations.map((o) => `- [${o.status}] ${o.summary}`).join("\n")}`
        : "Nenhuma observação foi coletada ainda (nenhuma ferramenta foi chamada).",
      assistantDraft ? `Rascunho de resposta do modelo: ${assistantDraft}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const evaluation = await structuredCall(
      this.llm,
      SYSTEM,
      context,
      "emit_evaluation",
      "Registra o veredito sobre se o objetivo foi atingido.",
      EvaluationSchema
    );

    if (evaluation) return evaluation;

    // R5 - deterministic fallback if the structured call didn't come back:
    // never silently assume success.
    const anyFailure = observations.some((o) => o.status !== "SUCCESS");
    return {
      verdict: anyFailure ? "FAIL" : "COMPLETE",
      rationale: "Fallback determinístico: o avaliador estruturado não retornou uma resposta válida.",
      userMessage: assistantDraft ?? "Não consegui determinar com segurança se o objetivo foi atingido.",
    };
  }
}
