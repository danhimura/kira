# aymi

Local desktop AI agent runtime (2D avatar + voice), built around the
architecture in the project specification: **the LLM proposes, the runtime
decides, the policy authorizes, the tool executes, the observation verifies,
the evaluator judges the goal, and TTS/avatar communicate state.**

This repo currently implements **Sprint 1** of the phased plan (section 39 of
the spec): a minimal but real runtime loop —

```
texto → LLM → tool → resultado → resposta
```

with a real Session Manager, Tool Registry/Executor, Event Bus, and a
persisted Trace. Everything else in the architecture (Planner, Policy Engine,
Observation Manager, Goal Evaluator, voice, avatar, evaluation harness) is
scaffolded as a stub folder with a `.sprint` file describing what belongs
there and which sprint fills it in — see the folder tree below.

## Requirements

- Node.js >= 22.5 (uses the built-in `node:sqlite` module — no native
  dependency to compile)
- [Ollama](https://ollama.com) running locally with a tool-calling-capable
  model pulled (default: `qwen3:30b-a3b-instruct-2507-q4_K_M`, the model
  named in the spec's section 37)

## Running

```bash
npm install
npm run dev
```

Environment variables (optional):

- `OLLAMA_HOST` — defaults to `http://localhost:11434`. A bare bind address
  like `0.0.0.0:11434` is accepted too and normalized to a dialable URL.
- `OLLAMA_MODEL` — defaults to `qwen3:30b-a3b-instruct-2507-q4_K_M`.
- `AYMI_DEBUG_TRACE=1` — print the section-26-style trace after each turn.
- `AYMI_DEBUG_EVENTS=1` — print every event bus emission as it happens.

Type "sair" or "exit" to end the session.

## What Sprint 1 actually does

1. `SessionManager` creates a session (`session_id`) and, per user message, a
   turn (`turn_id`, `trace_id`, `parent_trace_id` linking back to the
   session's previous turn).
2. `AgentStateMachine` walks the section-16 state machine
   (`IDLE → LISTENING → UNDERSTANDING → PLANNING → POLICY_CHECK → EXECUTING →
   OBSERVING → EVALUATING → SUCCESS/FAILED → IDLE`), rejecting any invalid
   transition in code (R3) — the LLM never touches this.
3. The user's message plus the tool catalog (from `ToolRegistry`) go to
   `OllamaProvider`. If the model requests a tool call, `ToolExecutor`:
   - looks the tool up in the registry (`TOOL_NOT_FOUND` if missing),
   - runs it through a risk gate (only `risk_level: "read_only"` tools are
     allowed to execute — this is the Sprint-1 stand-in for the real Policy
     Engine coming in Sprint 3),
   - validates its arguments against a Zod schema (`VALIDATION_ERROR` on
     mismatch),
   - runs it with a timeout, returning a `SUCCESS | FAILURE | UNKNOWN`
     result (section 13) — a timeout is `UNKNOWN`, never assumed success or
     failure.
4. The tool result is fed back to the model, which produces the final
   response (or another tool call, up to `MAX_TOOL_ROUNDTRIPS = 5` per turn —
   section 31's `max_tool_calls` limit).
5. Every step is appended to a `Trace` and persisted to
   `storage/aymi.sqlite` (`sessions` / `turns` / `trace_events` tables) —
   the groundwork for the replay feature in section 27.

### Built-in tools (all `read_only`)

| tool | description |
|---|---|
| `get_datetime` | current local date/time |
| `get_system_information` | OS/platform/CPU/memory/uptime |
| `list_processes` | running processes, optional name filter (Windows `tasklist`) |
| `read_file` | reads a text file, capped at ~200KB |
| `search_files` | recursive filename search, capped depth/result count |

Verified manually against a running Ollama instance: date/time + hostname
queries, a process-listing query, and a "open a program that doesn't exist"
query (correctly refused instead of inventing success — R5).

## Project layout

```
src/
├── runtime/
│   ├── session/        SessionManager (done)
│   ├── state/           AgentStateMachine (done)
│   ├── events/          EventBus (done)
│   ├── executor/        ToolExecutor (done)
│   ├── intent/          .sprint — Sprint 2
│   ├── planner/         .sprint — Sprint 2
│   ├── policy/          .sprint — Sprint 3 (real Policy Engine)
│   ├── observation/     .sprint — Sprint 2
│   ├── evaluator/       .sprint — Sprint 2
│   ├── interrupt/       .sprint — Sprint 3 (cancellation)
│   └── conversation/    .sprint — Sprint 2
├── llm/
│   ├── provider/         LLMProvider interface (done)
│   ├── ollama/           OllamaProvider (done)
│   ├── schemas/, prompts/  system prompt (done)
├── tools/
│   ├── registry/         ToolDefinition contract + ToolRegistry (done)
│   ├── windows/, process/, filesystem/  read-only tools (done)
│   ├── browser/          .sprint — Sprint 4
│   └── terminal/         .sprint — Sprint 4 (needs real Policy Engine first)
├── telemetry/
│   ├── tracing/          Trace (done)
│   ├── metrics/          .sprint — Sprint 5
│   └── replay/           .sprint — Sprint 5
├── evaluation/           .sprint — Sprint 5 (evaluation harness)
├── voice/                .sprint — Sprints 6/8 (TTS/STT/barge-in)
├── presentation/         .sprint — Sprint 7 (avatar/animation)
└── main.ts               CLI entrypoint wiring it all together
ui/                       .sprint — Sprint 7 (React frontend)
storage/                  SQLite database file lives here (gitignored)
```

## Next steps (per the spec's Sprint order)

- **Sprint 2** — real Planner/Observation Manager/Goal Evaluator, re-planning
  loop, retries, `max_steps`/`max_execution_time` limits.
- **Sprint 3** — real Policy Engine (ALLOW/DENY/REQUIRE_CONFIRMATION),
  Interrupt Manager (soft cancel / tool cancel / hard stop).
- **Sprint 4** — reversible/persistent/destructive tools (apps, files,
  browser, PowerShell) gated by the real policy.
