import type { ToolRegistry } from "./registry/ToolRegistry.js";
import { windowsTools } from "./windows/index.js";
import { processTools } from "./process/index.js";
import { filesystemTools } from "./filesystem/index.js";

/**
 * Sprint 1 tool set - all read_only. Sprint 4 adds reversible/persistent/
 * destructive tools (browser, terminal) once the real Policy Engine
 * (Sprint 3) is in place to gate them.
 */
export function registerBuiltinTools(registry: ToolRegistry): void {
  for (const tool of [...windowsTools, ...processTools, ...filesystemTools]) {
    registry.register(tool);
  }
}
