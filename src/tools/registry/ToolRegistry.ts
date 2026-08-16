import { zodToJsonSchema } from "./zodToJsonSchema.js";
import type { ToolDefinition } from "./ToolDefinition.js";

/**
 * Section 10 - lets the LLM discover capabilities without arbitrary system
 * access. Registration is the only way a tool becomes callable.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition<any, any>>();

  register(tool: ToolDefinition<any, any>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition<any, any> | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition<any, any>[] {
    return [...this.tools.values()];
  }

  /** Ollama/OpenAI-style tool-calling schema - the only surface the LLM sees. */
  describeForLlm(): Array<{
    type: "function";
    function: { name: string; description: string; parameters: unknown };
  }> {
    return this.list().map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.inputSchema),
      },
    }));
  }
}
