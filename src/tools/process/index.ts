import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition } from "../registry/ToolDefinition.js";

const execFileAsync = promisify(execFile);

const inputSchema = z.object({
  nameFilter: z.string().nullable().optional().describe("Case-insensitive substring to filter process names by."),
});

interface ProcessInfo {
  name: string;
  pid: number;
  memoryUsageKb: number;
}

async function listWindowsProcesses(signal: AbortSignal): Promise<ProcessInfo[]> {
  const { stdout } = await execFileAsync("tasklist", ["/fo", "csv", "/nh"], {
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    signal,
  });

  return stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      // CSV fields: "Image Name","PID","Session Name","Session#","Mem Usage"
      const fields = line.split('","').map((f) => f.replace(/^"|"$/g, ""));
      const [name, pid, , , memUsage] = fields;
      return {
        name,
        pid: Number.parseInt(pid, 10),
        memoryUsageKb: Number.parseInt(memUsage.replace(/[.,\s K]/g, ""), 10) || 0,
      };
    })
    .filter((p) => Number.isFinite(p.pid));
}

const listProcesses: ToolDefinition<
  z.infer<typeof inputSchema>,
  { count: number; processes: ProcessInfo[] }
> = {
  name: "list_processes",
  version: "1.0.0",
  description: "Lists running processes on the local machine, optionally filtered by a substring of the process name.",
  inputSchema,
  riskLevel: "read_only",
  permissions: [],
  timeoutMs: 5_000,
  cancellable: true,
  idempotency: "no",
  sideEffects: "none",
  confirmationPolicy: "none",
  environment: "windows",
  async execute({ nameFilter }, signal) {
    const all = await listWindowsProcesses(signal);
    const filtered = nameFilter
      ? all.filter((p) => p.name.toLowerCase().includes(nameFilter.toLowerCase()))
      : all;
    // Cap the payload so a broad query doesn't flood the LLM's context.
    return { count: filtered.length, processes: filtered.slice(0, 100) };
  },
};

export const processTools = [listProcesses];
