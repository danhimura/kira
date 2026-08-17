# aymi

Local desktop AI agent runtime (2D avatar + voice), built around the
architecture in the project specification: **the LLM proposes, the runtime
decides, the policy authorizes, the tool executes, the observation verifies,
the evaluator judges the goal, and TTS/avatar communicate state.**

This repo currently implements **Sprint 1 + Sprint 2** of the phased plan
(section 39 of the spec): a real `goal → plan → action → observation →
evaluate → replan` loop —

```
goal → action → observation → replan
```

with a real Session Manager, Intent Processor, Planner, Tool Registry/
Executor, Observation Manager, Goal Evaluator, Conversation Manager, Event
Bus, and a persisted Trace. Everything else in the architecture (Policy
Engine, Interrupt Manager, voice, avatar, evaluation harness) is scaffolded
as a stub folder with a `.sprint` file describing what belongs there and
which sprint fills it in — see the folder tree below.

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

## What Sprint 1 + 2 actually do

1. `SessionManager` creates a session (`session_id`) and, per user message, a
   turn (`turn_id`, `trace_id`, `parent_trace_id` linking back to the
   session's previous turn). `Session.worldState` accumulates StateDelta
   facts across turns (section 14).
2. `AgentStateMachine` walks the full section-16 state machine, rejecting
   any invalid transition in code (R3) — the LLM never touches this:
   ```
   IDLE → LISTENING → UNDERSTANDING → PLANNING → POLICY_CHECK → EXECUTING
        → OBSERVING → EVALUATING → { SUCCESS | FAILED | back to PLANNING (replan) | LISTENING (ask user) }
   ```
   An `ASK_USER` verdict leaves the machine parked at `LISTENING` (not
   terminal) so the next user message continues straight to
   `UNDERSTANDING` instead of restarting from `IDLE`.
3. `IntentProcessor` turns the raw message (+ recent conversation summary)
   into a structured `{ goal, target, constraints, requiresAction }` via a
   forced tool-call (`structuredCall`), not free-text parsing.
4. `Planner` produces a short provisional plan; on a `REPLAN` verdict it's
   asked again with the prior cycle's real observations, and explicitly
   told not to repeat an approach that already failed.
5. Inside `EXECUTING`, the model can call tools over several rounds. Every
   call goes through `ToolExecutor`, which:
   - looks the tool up in the registry (`TOOL_NOT_FOUND` if missing),
   - runs it through a risk gate (only `risk_level: "read_only"` tools are
     allowed to execute — the Sprint-1/2 stand-in for the real Policy
     Engine coming in Sprint 3),
   - validates arguments against a Zod schema (`VALIDATION_ERROR` on
     mismatch),
   - runs it with a timeout, returning `SUCCESS | FAILURE | UNKNOWN`
     (section 13) — a timeout is `UNKNOWN`, auto-retried once/twice only if
     the tool declares `idempotency: "yes"`.
6. `ObservationManager` deterministically turns each `ToolResult` into an
   `Observation` (human-readable summary + `stateDelta`), merged into
   `session.worldState` — the LLM never has to guess what a result "means".
7. `GoalEvaluator` looks at the goal + real observations (never the raw
   tool-call success/failure alone) and returns one of `COMPLETE / REPLAN /
   ASK_USER / FAIL`, plus the exact message to show the user. This is the
   section 15 principle in code: "did the goal get achieved?", not "did the
   last tool call succeed?".
8. Deterministic limits (section 31, `runtime/session/Limits.ts`) bound
   every turn: `maxSteps` (replanning cycles), `maxToolCalls`,
   `maxSameToolRetries` (stuck-loop guard), `maxExecutionTimeMs`. Hitting one
   ends the turn as `LIMIT_REACHED` rather than looping forever.
9. Every step (`INTENT`, `PLAN`, `POLICY_CHECK`, `TOOL_*`, `OBSERVATION`,
   `GOAL_EVALUATION`, `LIMIT_REACHED`, ...) is appended to a `Trace` and
   persisted to `storage/aymi.sqlite` (`sessions` / `turns` / `trace_events`
   tables) — the groundwork for the replay feature in section 27.

### Built-in tools (all `read_only`)

| tool | description |
|---|---|
| `get_datetime` | current local date/time |
| `get_system_information` | OS/platform/CPU/memory/uptime |
| `list_processes` | running processes, optional name filter (Windows `tasklist`) |
| `read_file` | reads a text file, capped at ~200KB |
| `search_files` | recursive filename search, capped depth/result count |

Verified manually against a running Ollama instance, covering all four
Goal Evaluator verdicts:
- **COMPLETE** — datetime + hostname query, answered from real tool data.
- **FAIL** — a `search_files` call that timed out 3x in a row (`UNKNOWN` →
  auto-retry → still `UNKNOWN`) correctly produced "insufficient evidence"
  rather than a guess; a `read_file` on a nonexistent path correctly
  reported failure instead of inventing content (R5).
- **ASK_USER** — "read the config file" (no path given) correctly asked for
  clarification instead of guessing a path, *and* the following turn
  continued correctly from the `LISTENING` state without any state-machine
  error.

## Project layout

```
src/
├── runtime/
│   ├── session/        SessionManager, Limits (done)
│   ├── state/           AgentStateMachine (done)
│   ├── events/          EventBus (done)
│   ├── intent/          IntentProcessor (done)
│   ├── planner/         Planner (done)
│   ├── executor/        ToolExecutor (done)
│   ├── observation/     ObservationManager (done)
│   ├── evaluator/       GoalEvaluator (done)
│   ├── conversation/    ConversationManager (done)
│   ├── policy/          .sprint — Sprint 3 (real Policy Engine)
│   └── interrupt/       .sprint — Sprint 3 (cancellation)
├── llm/
│   ├── provider/         LLMProvider interface (done)
│   ├── ollama/           OllamaProvider (done)
│   ├── schemas/          structuredCall() forced-tool-call helper (done)
│   └── prompts/          system prompt (done)
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

- **Sprint 3** — real Policy Engine (ALLOW/DENY/REQUIRE_CONFIRMATION) so
  reversible/persistent/destructive tools have somewhere to be gated, plus
  the Interrupt Manager (soft cancel / tool cancel / hard stop).
- **Sprint 4** — reversible/persistent/destructive tools (apps, files,
  browser, PowerShell) gated by the real policy.
- **Sprint 5** — Evaluation Harness (PASS/FAIL/NOT_APPLICABLE cases,
  including the negative cases in section 30).
