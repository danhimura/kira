import { z } from "zod";
import os from "node:os";
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

export const windowsTools = [getDatetime, getSystemInformation];
