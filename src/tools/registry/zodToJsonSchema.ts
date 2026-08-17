import { z } from "zod";

/**
 * Minimal Zod -> JSON Schema converter covering the subset of Zod used by
 * this project's tool input schemas (object/string/number/boolean/enum/
 * array/optional). Good enough for Ollama/OpenAI-style function-calling
 * `parameters`; swap for the `zod-to-json-schema` package if schemas grow
 * more complex.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): unknown {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!value.isOptional()) required.push(key);
    }

    return {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
    };
  }

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return zodToJsonSchema(schema._def.innerType);
  }

  // Some providers (Groq) strictly validate a tool call's arguments against
  // the schema and reject the whole call if an optional field comes back as
  // JSON null instead of being omitted - which models do fairly often for
  // "no value" fields. .optional() alone only covers omission (undefined);
  // .nullable() is needed too, and needs its own JSON Schema type union.
  if (schema instanceof z.ZodNullable) {
    const inner = zodToJsonSchema(schema._def.innerType) as { type?: unknown };
    const innerType = inner.type;
    const type = Array.isArray(innerType) ? [...innerType, "null"] : innerType !== undefined ? [innerType, "null"] : "null";
    return { ...inner, type };
  }

  if (schema instanceof z.ZodString) {
    const desc = schema.description ? { description: schema.description } : {};
    return { type: "string", ...desc };
  }

  if (schema instanceof z.ZodNumber) {
    return { type: "number" };
  }

  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }

  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: schema.options };
  }

  if (schema instanceof z.ZodArray) {
    return { type: "array", items: zodToJsonSchema(schema.element) };
  }

  return {};
}
