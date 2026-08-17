import { z } from "zod";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ToolDefinition } from "../registry/ToolDefinition.js";

const MAX_READ_BYTES = 200_000;
const MAX_SEARCH_RESULTS = 200;
const SEARCH_SKIP_DIRS = new Set([".git", "node_modules", "dist"]);

const readFileInput = z.object({
  path: z.string().describe("Absolute or relative path of the file to read."),
});

const readFileTool: ToolDefinition<
  z.infer<typeof readFileInput>,
  { path: string; content: string; truncated: boolean; sizeBytes: number }
> = {
  name: "read_file",
  version: "1.0.0",
  description: "Reads a text file from the local filesystem (read-only, capped at ~200KB).",
  inputSchema: readFileInput,
  riskLevel: "read_only",
  permissions: ["filesystem:read"],
  timeoutMs: 5_000,
  cancellable: true,
  idempotency: "yes",
  sideEffects: "none",
  confirmationPolicy: "none",
  environment: "cross-platform",
  async execute({ path }, signal) {
    const absolutePath = resolve(path);
    const info = await stat(absolutePath);
    if (!info.isFile()) {
      throw new Error(`Not a file: ${absolutePath}`);
    }

    const buffer = await readFile(absolutePath, { signal });
    const truncated = buffer.byteLength > MAX_READ_BYTES;
    const content = buffer.subarray(0, MAX_READ_BYTES).toString("utf-8");

    return { path: absolutePath, content, truncated, sizeBytes: info.size };
  },
};

const searchFilesInput = z.object({
  directory: z.string().describe("Directory to search under."),
  pattern: z.string().describe("Case-insensitive substring to match against file names."),
  maxDepth: z.number().int().min(0).max(10).optional(),
});

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }
}

async function walk(dir: string, pattern: string, maxDepth: number, results: string[], signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (results.length >= MAX_SEARCH_RESULTS || maxDepth < 0) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    throwIfAborted(signal);
    if (results.length >= MAX_SEARCH_RESULTS) return;
    if (SEARCH_SKIP_DIRS.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, pattern, maxDepth - 1, results, signal);
    } else if (entry.name.toLowerCase().includes(pattern.toLowerCase())) {
      results.push(fullPath);
    }
  }
}

const searchFilesTool: ToolDefinition<
  z.infer<typeof searchFilesInput>,
  { count: number; truncated: boolean; paths: string[] }
> = {
  name: "search_files",
  version: "1.0.0",
  description: "Recursively searches a directory for file names containing a substring (read-only, capped results/depth).",
  inputSchema: searchFilesInput,
  riskLevel: "read_only",
  permissions: ["filesystem:read"],
  timeoutMs: 10_000,
  cancellable: true,
  idempotency: "yes",
  sideEffects: "none",
  confirmationPolicy: "none",
  environment: "cross-platform",
  async execute({ directory, pattern, maxDepth }, signal) {
    const absoluteDir = resolve(directory);
    const results: string[] = [];
    await walk(absoluteDir, pattern, maxDepth ?? 6, results, signal);
    return { count: results.length, truncated: results.length >= MAX_SEARCH_RESULTS, paths: results };
  },
};

export const filesystemTools = [readFileTool, searchFilesTool];
