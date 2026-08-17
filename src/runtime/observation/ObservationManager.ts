import type { ToolResult } from "../executor/ToolExecutor.js";

export interface Observation {
  tool: string;
  status: "SUCCESS" | "FAILURE" | "UNKNOWN";
  summary: string;
  stateDelta: Record<string, unknown>;
}

type SuccessResult = Extract<ToolResult, { status: "SUCCESS" }>;
type Interpreter = (result: SuccessResult) => { summary: string; stateDelta: Record<string, unknown> };

// Section 14 - deterministic, per-tool mappings from raw SUCCESS data to a
// human-readable observation + state delta. New tools without an entry here
// still get a safe generic observation (see observe() below) - this map is
// an enrichment, not a requirement.
const INTERPRETERS: Record<string, Interpreter> = {
  get_datetime: (r) => {
    const d = r.data as { iso: string; locale: string; timezone: string };
    return { summary: `Horário atual: ${d.iso} (${d.timezone})`, stateDelta: { currentDatetimeIso: d.iso } };
  },
  get_system_information: (r) => {
    const d = r.data as { platform: string; arch: string; hostname: string };
    return {
      summary: `Sistema: ${d.platform}/${d.arch}, host "${d.hostname}"`,
      stateDelta: { hostname: d.hostname, platform: d.platform, arch: d.arch },
    };
  },
  list_processes: (r) => {
    const d = r.data as { count: number };
    return { summary: `${d.count} processo(s) encontrado(s).`, stateDelta: { lastProcessCount: d.count } };
  },
  read_file: (r) => {
    const d = r.data as { path: string; sizeBytes: number; truncated: boolean };
    return {
      summary: `Arquivo lido: ${d.path} (${d.sizeBytes} bytes${d.truncated ? ", truncado" : ""}).`,
      stateDelta: { lastReadFile: d.path },
    };
  },
  search_files: (r) => {
    const d = r.data as { count: number; truncated: boolean };
    return {
      summary: `${d.count} arquivo(s) encontrado(s)${d.truncated ? " (limite de resultados atingido)" : ""}.`,
      stateDelta: { lastSearchCount: d.count },
    };
  },
};

/**
 * Section 14 - converts a raw ToolResult into a semantic Observation with an
 * explicit StateDelta. This is deterministic code (R3): the LLM never
 * decides what a tool result "means" for the environment's known state.
 */
export class ObservationManager {
  observe(result: ToolResult): Observation {
    if (result.status === "SUCCESS") {
      const interpreter = INTERPRETERS[result.tool];
      const { summary, stateDelta } = interpreter
        ? interpreter(result)
        : { summary: `${result.tool} concluída com sucesso.`, stateDelta: {} };
      return { tool: result.tool, status: "SUCCESS", summary, stateDelta };
    }

    if (result.status === "UNKNOWN") {
      return {
        tool: result.tool,
        status: "UNKNOWN",
        summary: `${result.tool}: resultado desconhecido (${result.reason}). Não presuma sucesso nem falha.`,
        stateDelta: {},
      };
    }

    return {
      tool: result.tool,
      status: "FAILURE",
      summary: `${result.tool} falhou: [${result.error.code}] ${result.error.message}`,
      stateDelta: {},
    };
  }
}
