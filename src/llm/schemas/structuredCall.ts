import type { z } from "zod";
import { zodToJsonSchema } from "../../tools/registry/zodToJsonSchema.js";
import type { ChatMessage, LLMProvider } from "../provider/LLMProvider.js";

/**
 * Forces a single tool call to get validated structured JSON back from the
 * LLM, instead of parsing free-form text. Used by IntentProcessor/Planner/
 * GoalEvaluator - components whose job is "interpret ambiguous input", which
 * section 4 assigns to the LLM, but whose *output shape* must stay
 * deterministic and schema-checked (R3) rather than hand-parsed.
 *
 * Returns undefined if the model didn't call the tool or produced arguments
 * that fail schema validation - callers must supply a deterministic fallback
 * (R5 - absence of information must not become invention).
 */
export async function structuredCall<T>(
  llm: LLMProvider,
  systemPrompt: string,
  userContent: string,
  toolName: string,
  toolDescription: string,
  schema: z.ZodType<T>
): Promise<T | undefined> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  const tools = [
    {
      type: "function" as const,
      function: {
        name: toolName,
        description: toolDescription,
        parameters: zodToJsonSchema(schema),
      },
    },
  ];

  const result = await llm.chat(messages, tools);
  const call = result.toolCalls?.find((c) => c.name === toolName);
  if (!call) return undefined;

  const parsed = schema.safeParse(call.arguments);
  return parsed.success ? parsed.data : undefined;
}
