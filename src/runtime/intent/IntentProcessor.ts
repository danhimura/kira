import { z } from "zod";
import type { LLMProvider } from "../../llm/provider/LLMProvider.js";
import { structuredCall } from "../../llm/schemas/structuredCall.js";

// Section 7 - the intent is not the plan. This only captures *what* the user
// wants, not *how* to get there.
export const IntentSchema = z.object({
  goal: z.string().describe("Short imperative description of what the user wants achieved."),
  target: z.string().nullable().optional().describe("The main subject/entity of the request, if any (e.g. an app name, a file, a topic)."),
  constraints: z.array(z.string()).describe("Any explicit constraints or conditions the user stated (empty array if none)."),
  requiresAction: z.boolean().describe("True if satisfying this goal requires calling a tool; false for pure conversation/small talk."),
});
export type Intent = z.infer<typeof IntentSchema>;

const SYSTEM = `Você converte a mensagem do usuário em uma intenção estruturada, considerando o histórico recente da conversa como contexto. Chame SEMPRE a função emit_intent com sua análise - nunca responda em texto livre.`;

export class IntentProcessor {
  constructor(private readonly llm: LLMProvider) {}

  async process(userText: string, recentHistory?: string): Promise<Intent> {
    const context = recentHistory
      ? `Histórico recente:\n${recentHistory}\n\nMensagem atual: ${userText}`
      : `Mensagem atual: ${userText}`;

    const intent = await structuredCall(
      this.llm,
      SYSTEM,
      context,
      "emit_intent",
      "Registra a intenção estruturada extraída da mensagem do usuário.",
      IntentSchema
    );

    // R5 - no structured intent back means we don't invent one; fall back to
    // the raw text as the goal and assume action may be required.
    return intent ?? { goal: userText, constraints: [], requiresAction: true };
  }
}
