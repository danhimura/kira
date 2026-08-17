import { z } from "zod";
import os from "node:os";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolDefinition } from "../registry/ToolDefinition.js";

const getDatetime: ToolDefinition<Record<string, never>, { iso: string; locale: string; timezone: string }> = {
  name: "get_datetime",
  version: "1.0.0",
  description: "Returns the current local date and time.",
  inputSchema: z.object({}),
  riskLevel: "read_only",
  permissions: [],
  timeoutMs: 2_000,
  cancellable: false,
  idempotency: "no",
  sideEffects: "none",
  confirmationPolicy: "none",
  environment: "cross-platform",
  async execute() {
    const now = new Date();
    return {
      iso: now.toISOString(),
      locale: now.toLocaleString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  },
};

const getSystemInformation: ToolDefinition<
  Record<string, never>,
  {
    platform: string;
    arch: string;
    hostname: string;
    cpuModel: string;
    cpuCount: number;
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    uptimeSeconds: number;
  }
> = {
  name: "get_system_information",
  version: "1.0.0",
  description: "Returns basic OS/hardware information for the local machine (platform, arch, CPU, memory, uptime).",
  inputSchema: z.object({}),
  riskLevel: "read_only",
  permissions: [],
  timeoutMs: 2_000,
  cancellable: false,
  idempotency: "no",
  sideEffects: "none",
  confirmationPolicy: "none",
  environment: "cross-platform",
  async execute() {
    const cpus = os.cpus();
    return {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpuModel: cpus[0]?.model ?? "unknown",
      cpuCount: cpus.length,
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      uptimeSeconds: os.uptime(),
    };
  },
};

const openFolderInput = z.object({
  path: z.string().describe("Directory to open in Windows Explorer."),
});

// Section 11.2 - a reversible tool (easily closed by the user), registered
// specifically to exercise the Sprint 3 Policy Engine's REQUIRE_CONFIRMATION
// path end-to-end. Destructive/persistent tools proper arrive in Sprint 4.
const openFolder: ToolDefinition<z.infer<typeof openFolderInput>, { opened: string }> = {
  name: "open_folder",
  version: "1.0.0",
  description: "Opens a folder in Windows Explorer.",
  inputSchema: openFolderInput,
  riskLevel: "reversible",
  permissions: ["shell:open"],
  timeoutMs: 5_000,
  cancellable: false,
  idempotency: "partial",
  sideEffects: "reversible",
  confirmationPolicy: "risk_based",
  environment: "windows",
  async execute({ path }) {
    const absolutePath = resolve(path);
    const info = await stat(absolutePath);
    if (!info.isDirectory()) {
      throw new Error(`Not a directory: ${absolutePath}`);
    }

    // explorer.exe often exits non-zero for benign reasons even when the
    // window opened fine, so this is fire-and-forget rather than awaited.
    spawn("explorer.exe", [absolutePath], { detached: true, stdio: "ignore" }).unref();
    return { opened: absolutePath };
  },
};

export const windowsTools = [getDatetime, getSystemInformation, openFolder];
