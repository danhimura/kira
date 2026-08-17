# aymi

Local desktop AI agent runtime (2D avatar + voice), built around the
architecture in the project specification: **the LLM proposes, the runtime
decides, the policy authorizes, the tool executes, the observation verifies,
the evaluator judges the goal, and TTS/avatar communicate state.**

This repo currently implements **Sprints 1–3** of the phased plan
(section 39 of the spec): a real `goal → plan → action → observation →
evaluate → replan` loop, now with real authorization —

```
goal → action → observation → replan
```

with a real Session Manager, Intent Processor, Planner, Tool Registry/
Executor, Observation Manager, Goal Evaluator, Conversation Manager, Policy
Engine, Interrupt Manager, Event Bus, and a persisted Trace. **The LLM has no
direct authority: every tool call is judged by the deterministic Policy
Engine before it runs** (section 39's Sprint 3 goal). Everything else in the
architecture (destructive tools, voice, avatar, evaluation harness) is
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

Type "sair" or "exit" to end the session. **Ctrl+C** cancels whatever turn
is currently running (soft cancel); a second Ctrl+C (or one with nothing
running) exits the program (hard stop).

## What Sprints 1–3 actually do

1. `SessionManager` creates a session (`session_id`) and, per user message, a
   turn (`turn_id`, `trace_id`, `parent_trace_id` linking back to the
   session's previous turn). `Session.worldState` accumulates StateDelta
   facts across turns (section 14); `Session.approvedTools` remembers which
   tools the user has already confirmed this session.
2. `AgentStateMachine` walks the full section-16 state machine, rejecting
   any invalid transition in code (R3) — the LLM never touches this:
   ```
   IDLE → LISTENING → UNDERSTANDING → PLANNING → POLICY_CHECK → EXECUTING
        ⇄ WAITING_CONFIRMATION (per tool call needing one)
        → OBSERVING → EVALUATING → { SUCCESS | FAILED | CANCELLED
                                    | back to PLANNING (replan)
                                    | LISTENING (ask user) }
   ```
   `EXECUTING ⇄ WAITING_CONFIRMATION` happens per tool call, not once per
   cycle, since the Policy Engine's decision isn't known until the LLM
   actually proposes a specific call. An `ASK_USER` verdict leaves the
   machine parked at `LISTENING` (not terminal) so the next user message
   continues straight to `UNDERSTANDING` instead of restarting from `IDLE`.
3. `IntentProcessor` turns the raw message (+ recent conversation summary)
   into a structured `{ goal, target, constraints, requiresAction }` via a
   forced tool-call (`structuredCall`), not free-text parsing.
4. `Planner` produces a short provisional plan; on a `REPLAN` verdict it's
   asked again with the prior cycle's real observations, and explicitly
   told not to repeat an approach that already failed.
5. Inside `EXECUTING`, for every tool call the model proposes, **`PolicyEngine.decide()`**
   judges it — deterministically, from the tool's `risk_level` +
   `confirmationPolicy` + `environment` (section 9), never the LLM:
   - **DENY** (e.g. an `environment: "windows"` tool on a non-Windows host) →
     the call never runs; a synthetic `FAILURE` result is produced.
   - **REQUIRE_CONFIRMATION** (`reversible`/`persistent`/`destructive` risk) →
     the FSM enters `WAITING_CONFIRMATION`, the user is asked interactively,
     and the decision is remembered per tool for the rest of the session
     (except `destructive`, which always re-confirms).
   - **ALLOW** (`read_only`, or already approved this session) → runs
     immediately.

   Whatever the decision, execution then goes through `ToolExecutor`, which:
   - looks the tool up in the registry (`TOOL_NOT_FOUND` if missing),
   - validates arguments against a Zod schema (`VALIDATION_ERROR` on
     mismatch),
   - runs it with a timeout and a shared per-turn `AbortSignal` (section 32 -
     Interrupt Manager), returning `SUCCESS | FAILURE | UNKNOWN` (section 13)
     — a timeout is `UNKNOWN`, auto-retried once/twice only if the tool
     declares `idempotency: "yes"`; a cancellation is `FAILURE{CANCELLED}`.
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
9. `InterruptManager` gives every turn one shared `AbortSignal` (section 32).
   **Soft cancel**: `requestCancel()` is checked at every loop boundary
   (between cycles, before each LLM call, before each tool call), ending the
   turn as `CANCELLED` rather than starting anything new. **Tool cancel**:
   the same signal is handed to `tool.execute()`, so a `cancellable: true`
   tool already in flight (e.g. `execFile`, `fs.readFile`, the
   `search_files` walk) actually aborts instead of running to completion.
   **Hard stop**: a second Ctrl+C (or one with nothing running) calls the
   same `shutdown()` used for a clean exit.
10. Every step (`INTENT`, `PLAN`, `POLICY_CHECK`, `POLICY_DECISION`,
    `TOOL_*`, `OBSERVATION`, `GOAL_EVALUATION`, `LIMIT_REACHED`,
    `CANCELLED`, ...) is appended to a `Trace` and persisted to
    `storage/aymi.sqlite` (`sessions` / `turns` / `trace_events` tables) —
    the groundwork for the replay feature in section 27.

### Built-in tools

| tool | risk_level | confirmation |
|---|---|---|
| `get_datetime` | `read_only` | none |
| `get_system_information` | `read_only` | none |
| `list_processes` | `read_only` | none |
| `read_file` | `read_only` | none |
| `search_files` | `read_only` | none |
| `open_folder` | `reversible` | required (once per session) |

`open_folder` (opens Windows Explorer at a path) was added specifically to
give the Sprint 3 Policy Engine something concrete to gate — a real
`reversible`-risk action, per section 11.2. Genuinely `persistent`/
`destructive` tools stay Sprint 4, once there's more to say about them than
"the same confirmation gate, every time."

Verified manually against a running Ollama instance:
- **Goal Evaluator verdicts** — `COMPLETE` (datetime + hostname query);
  `FAIL` (a `search_files` timeout retried automatically, still `UNKNOWN`,
  correctly reported as "insufficient evidence" rather than a guess; a
  `read_file` on a nonexistent path correctly reported failure instead of
  inventing content, R5); `ASK_USER` ("read the config file", no path given,
  followed by a correct continuation from `LISTENING` on the next turn with
  no state-machine error).
- **Policy Engine** — `open_folder` correctly required confirmation;
  accepting it (`s`) ran the tool and reported success; declining it (`n`)
  produced a clean `CONFIRMATION_DENIED` failure without running anything;
  a second request for the same tool in one session was auto-allowed from
  `session.approvedTools` without re-prompting.
- **Interrupt Manager** — a synthetic slow tool confirmed both halves of
  section 32 directly: cancelling *before* a tool starts rejects immediately
  (`CANCELLED`, no execution); cancelling *while* a cancellable tool is
  running aborts it promptly (~300ms into a simulated 5s operation) instead
  of waiting it out.

## Project layout

```
src/
├── runtime/
│   ├── session/        SessionManager, Limits (done)
│   ├── state/           AgentStateMachine (done)
│   ├── events/          EventBus (done)
│   ├── intent/          IntentProcessor (done)
│   ├── planner/         Planner (done)
│   ├── policy/          PolicyEngine (done)
│   ├── executor/        ToolExecutor (done)
│   ├── observation/     ObservationManager (done)
│   ├── evaluator/       GoalEvaluator (done)
│   ├── interrupt/        InterruptManager (done)
│   └── conversation/    ConversationManager (done)
├── llm/
│   ├── provider/         LLMProvider interface (done)
│   ├── ollama/           OllamaProvider (done)
│   ├── schemas/          structuredCall() forced-tool-call helper (done)
│   └── prompts/          system prompt (done)
├── tools/
│   ├── registry/         ToolDefinition contract + ToolRegistry (done)
│   ├── windows/, process/, filesystem/  tools incl. open_folder (done)
│   ├── browser/          .sprint — Sprint 4
│   └── terminal/         .sprint — Sprint 4 (destructive tools)
├── telemetry/
│   ├── tracing/          Trace (done)
│   ├── metrics/          .sprint — Sprint 5
│   └── replay/           .sprint — Sprint 5
├── evaluation/           .sprint — Sprint 5 (evaluation harness)
├── voice/                .sprint — Sprints 6/8 (TTS/STT/barge-in)
├── presentation/         .sprint — Sprint 7 (avatar/animation)
└── main.ts               CLI entrypoint wiring it all together (includes a
                           small LineReader - see note below)
ui/                       .sprint — Sprint 7 (React frontend)
storage/                  SQLite database file lives here (gitignored)
```

> **Implementation note on `main.ts`'s `LineReader`:** Node's `readline`
> offers two ways to consume input — `rl.question()` (one-shot, promise-based)
> and `for await...of rl` (async iterator) — and neither fits a CLI that
> needs both a main prompt *and* interactive confirmation prompts.
> `rl.question()` alone drops lines that arrive before the next call
> re-arms its listener (observed with piped/redirected input); mixing it
> with `for await...of rl` is explicitly documented as unsafe. `LineReader`
> buffers every `line` event itself and hands lines out on demand, so both
> the main loop and `confirm()` share one safe mechanism instead of running
> into either failure mode.

## Next steps (per the spec's Sprint order)

- **Sprint 4** — reversible/persistent/destructive tools proper (apps,
  files, browser, PowerShell) gated by the Policy Engine built in Sprint 3.
- **Sprint 5** — Evaluation Harness (PASS/FAIL/NOT_APPLICABLE cases,
  including the negative cases in section 30).
- **Sprint 6** — integrate the existing local TTS.
