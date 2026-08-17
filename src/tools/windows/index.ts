import { z } from "zod";
import os from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolDefinition } from "../registry/ToolDefinition.js";
import { listInstalledApps as listInstalledAppsFromStartMenu } from "./InstalledApps.js";

const execFileAsync = promisify(execFile);

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

/**
 * Fire-and-forget launch with a short grace period to catch fast failures
 * (e.g. "'xyz' is not recognized...") without blocking on GUI apps that keep
 * running indefinitely. A fast non-zero exit is treated as failure; timing
 * out the grace period or a fast exit(0) is treated as success.
 */
function launchAndDetectFailure(command: string, signal: AbortSignal, graceMs = 800): Promise<{ pid?: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], { shell: true, windowsHide: false, stdio: ["ignore", "ignore", "pipe"] });
    let settled = false;
    let stderr = "";

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const onAbort = () => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* best effort */
      }
      const err = new Error("Aborted");
      err.name = "AbortError";
      reject(err);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(err);
    });

    child.once("exit", (code) => {
      if (settled || code === 0 || code === null) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(new Error(stderr.trim() || `Command exited with code ${code}`));
    });

    setTimeout(() => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      child.unref();
      resolve({ pid: child.pid });
    }, graceMs);
  });
}

const listInstalledAppsInput = z.object({
  nameFilter: z.string().nullable().optional().describe("Case-insensitive substring to filter app names by."),
});

// Section 11/TC-VOICE-003 of docs/specs/KIRA_VOICE_INTEGRATION_SPEC.md - when
// voice input mis-transcribes an app name ("Chrome" heard as "cron"/"cromi"),
// resolving that is the Agent Runtime's job, not the voice module's, and not
// a hardcoded synonym table either (doesn't scale, and plain character edit
// distance actively picks the *wrong* app - "cron" is spelling-closer to
// "Cross" than to "Chrome" despite sounding like it). The LLM itself is
// better at this kind of phonetic/spelling judgment call than a hand-rolled
// distance metric, so it just gets the real installed-app list to reason
// over instead.
const listInstalledApps: ToolDefinition<z.infer<typeof listInstalledAppsInput>, { count: number; apps: { name: string; path: string }[] }> = {
  name: "list_installed_apps",
  version: "1.0.0",
  description:
    "Lists applications actually installed on this machine (from Start Menu shortcuts), with the exact executable path to pass to open_application. Use this before open_application whenever the target name might be a phonetic mis-transcription from voice input (e.g. 'cron' or 'cromi' likely meant 'Chrome') or you're otherwise unsure of the exact name.",
  inputSchema: listInstalledAppsInput,
  riskLevel: "read_only",
  permissions: [],
  timeoutMs: 5_000,
  cancellable: false,
  idempotency: "no",
  sideEffects: "none",
  confirmationPolicy: "none",
  environment: "windows",
  async execute({ nameFilter }) {
    const all = await listInstalledAppsFromStartMenu();
    const filtered = nameFilter ? all.filter((a) => a.name.toLowerCase().includes(nameFilter.toLowerCase())) : all;
    return { count: filtered.length, apps: filtered.slice(0, 150) };
  },
};

const openApplicationInput = z.object({
  target: z.string().describe("Executable name resolvable via PATH (e.g. 'notepad', 'calc') or an absolute path to an .exe."),
});

const openApplication: ToolDefinition<z.infer<typeof openApplicationInput>, { launched: string; pid?: number }> = {
  name: "open_application",
  version: "1.0.0",
  description:
    "Launches an application by executable name (resolved via PATH) or absolute path. If unsure of the exact name (especially for voice-transcribed input, which can mis-hear app names phonetically), call list_installed_apps first.",
  inputSchema: openApplicationInput,
  riskLevel: "reversible",
  permissions: ["process:spawn"],
  timeoutMs: 5_000,
  cancellable: true,
  idempotency: "partial",
  sideEffects: "reversible",
  confirmationPolicy: "risk_based",
  environment: "windows",
  async execute({ target }, signal) {
    const { pid } = await launchAndDetectFailure(target, signal);
    return { launched: target, pid };
  },
};

const closeApplicationInput = z.object({
  name: z.string().describe("Process image name to close gracefully, e.g. 'notepad.exe'."),
});

const closeApplication: ToolDefinition<z.infer<typeof closeApplicationInput>, { closed: string }> = {
  name: "close_application",
  version: "1.0.0",
  description: "Gracefully closes all running instances of a process by image name (no forced termination - see kill_process for that).",
  inputSchema: closeApplicationInput,
  riskLevel: "reversible",
  permissions: ["process:terminate"],
  timeoutMs: 5_000,
  cancellable: true,
  idempotency: "yes",
  sideEffects: "reversible",
  confirmationPolicy: "risk_based",
  environment: "windows",
  async execute({ name }, signal) {
    await execFileAsync("taskkill", ["/IM", name, "/T"], { windowsHide: true, signal });
    return { closed: name };
  },
};

const openUrlInput = z.object({
  url: z.string().url().describe("Web URL to open in the default browser (http/https only)."),
});

const openUrl: ToolDefinition<z.infer<typeof openUrlInput>, { opened: string }> = {
  name: "open_url",
  version: "1.0.0",
  description: "Opens a web URL in the user's default browser.",
  inputSchema: openUrlInput,
  riskLevel: "reversible",
  permissions: ["shell:open"],
  timeoutMs: 5_000,
  cancellable: false,
  idempotency: "partial",
  sideEffects: "reversible",
  confirmationPolicy: "risk_based",
  environment: "windows",
  async execute({ url }) {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
    }
    // Array-form args (not a concatenated shell string) so the URL is passed
    // to cmd.exe as a single argv element, not interpreted as shell syntax.
    spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return { opened: url };
  },
};

const focusWindowInput = z.object({
  titleContains: z.string().describe("Substring to match against open window titles."),
});

const focusWindow: ToolDefinition<z.infer<typeof focusWindowInput>, { focused: string }> = {
  name: "focus_window",
  version: "1.0.0",
  description: "Brings the first window whose title contains the given substring to the foreground.",
  inputSchema: focusWindowInput,
  riskLevel: "reversible",
  permissions: ["ui:focus"],
  timeoutMs: 5_000,
  cancellable: true,
  idempotency: "yes",
  sideEffects: "reversible",
  confirmationPolicy: "risk_based",
  environment: "windows",
  async execute({ titleContains }, signal) {
    // Single-quoted PowerShell string literal - '' is the only escape needed,
    // and single-quoted strings don't expand variables/expressions.
    const escaped = titleContains.replace(/'/g, "''");
    const script = `$result = (New-Object -ComObject WScript.Shell).AppActivate('${escaped}'); if (-not $result) { throw 'Window not found or could not be activated' }`;
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      signal,
    });
    return { focused: titleContains };
  },
};

export const windowsTools = [
  getDatetime,
  getSystemInformation,
  openFolder,
  listInstalledApps,
  openApplication,
  closeApplication,
  openUrl,
  focusWindow,
];
