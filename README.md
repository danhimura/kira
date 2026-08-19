# aymi

Local desktop AI agent runtime (2D avatar + voice), built around the
architecture in the project specification: **the LLM proposes, the runtime
decides, the policy authorizes, the tool executes, the observation verifies,
the evaluator judges the goal, and TTS/avatar communicate state.**

This repo currently implements **Sprints 1–7** of the phased plan
(section 39 of the spec): a real `goal → plan → action → observation →
evaluate → replan` loop, real authorization, a growing set of tools that
actually act on the machine, an Evaluation Harness that grades the whole
thing against the real runtime, a voice, and now a visual front end —

```
goal → action → observation → replan
```

with a real Session Manager, Intent Processor, Planner, Tool Registry/
Executor, Observation Manager, Goal Evaluator, Conversation Manager, Policy
Engine, Interrupt Manager, Event Bus, and a persisted Trace. **The LLM has no
direct authority: every tool call is judged by the deterministic Policy
Engine before it runs** (section 39's Sprint 3 goal), Sprint 4 adds real
reversible/persistent tools behind that same gate — "agente executando
tarefas reais" — Sprint 5 adds a real Evaluation Harness ("runtime
mensurável") that runs cases against that exact runtime and grades every
requirement independently, per section 29, Sprint 6 wires in an existing
local TTS engine with streaming, a speech queue, and interruption —
"agente vocal" — and Sprint 7 adds a browser front end with a Presentation
State Machine, an Animation Controller, and an animated 2D avatar reacting
live to the same events — "agente visual." Everything else in the
architecture (destructive tools, browser automation, STT/voice-triggered
barge-in) is scaffolded as a stub folder with a `.sprint` file describing
what belongs there and which sprint fills it in — see the folder tree below.

## Requirements

- Node.js >= 22.5 (uses the built-in `node:sqlite` module — no native
  dependency to compile)
- [Ollama](https://ollama.com) running locally with a tool-calling-capable
  model pulled (default: `gemma4:e4b`) - or an API-based provider instead,
  see below.

## Running

```bash
npm install
npm run dev
```

### LLM provider (local Ollama, or DeepSeek/Groq via API)

`OllamaProvider` and `OpenAICompatibleProvider` both implement the same
`LLMProvider` interface (section 7's R7 - substitutable), so
`AgentRuntime.createAgentRuntime()` picks one at startup based on
`LLM_PROVIDER`, and nothing else in the runtime knows or cares which:

```bash
LLM_PROVIDER=          # unset/anything else - local Ollama (default)
LLM_PROVIDER=deepseek  # needs DEEPSEEK_API_KEY
LLM_PROVIDER=groq      # needs GROQ_API_KEY
```

Put these in a `.env` file at the repo root (gitignored, loaded
automatically via `--env-file-if-exists` on the `dev`/`server`/`eval`
scripts) rather than exporting them by hand:

```
LLM_PROVIDER=groq
GROQ_API_KEY=...
DEEPSEEK_API_KEY=...
```

**Why this exists**: this session ran into the local Ollama model being
either too large to fit comfortably in memory alongside the Tauri overlay
+ WSL/OmniVoice + whisper.cpp all running at once (`qwen3:30b-a3b-
instruct-2507-q4_K_M`, ~18.6GB), or - once switched to a lighter model
(`gemma4:e4b`, ~9.6GB, confirmed fully offloaded to GPU) - each full agent
turn (intent → plan → execute → evaluate is 4+ sequential LLM calls, see
"What Sprints 1–7 actually do" below) taking well over the 60s execution
limit, because that model's verbose chain-of-thought ran on every single
call. Two real fixes came out of this:
1. `OllamaProvider` now always sends `think: false` - cut a single
   tool-call round-trip from ~24s to ~4s in testing.
2. `LLM_PROVIDER=groq` bypasses local inference limits entirely - Groq's
   hardware answered the same real tool-call request in ~0.4s total,
   dramatically faster than anything tested locally. Trade-off: this sends
   the user's input to a third-party API and needs internet, which is a
   real departure from the project's original "everything local" premise
   (local TTS, local STT) - a deliberate, explicit opt-in via
   `LLM_PROVIDER`, not the default.

Environment variables (optional):

- `OLLAMA_HOST` — defaults to `http://localhost:11434`. A bare bind address
  like `0.0.0.0:11434` is accepted too and normalized to a dialable URL.
- `OLLAMA_MODEL` — defaults to `qwen3:30b-a3b-instruct-2507-q4_K_M`.
- `OLLAMA_NUM_CTX` — context window (tokens) requested per call, defaults to
  `16384`. Ollama itself defaults to `4096` if no `num_ctx` is sent, which
  our tool schemas + conversation history can exceed once a turn has run a
  few tool calls (surfaced as a `400 exceed_context_size_error`). Each tool
  result is also capped at `maxToolResultChars` (2,000 chars, section 31's
  `max_context`) before being added to conversation history, since a broad
  `search_files`/`list_processes` call can return hundreds of entries.
- `AYMI_DEBUG_TRACE=1` — print the section-26-style trace after each turn.
- `AYMI_DEBUG_EVENTS=1` — print every event bus emission as it happens.
- `AYMI_VOICE=0` — disable voice output entirely (text-only).
- `OMNIVOICE_BASE_URL` — defaults to `http://localhost:8765` (see Voice below).
- `OMNIVOICE_VOICE` — defaults to `"auto"`; see `GET /v1/voices` on the
  OmniVoice server for presets (`alloy`, `ash`, ...) or `design:<attributes>`.

Type "sair" or "exit" to end the session. **Ctrl+C** cancels whatever turn
is currently running (soft cancel, and stops any ongoing speech); a second
Ctrl+C (or one with nothing running) exits the program (hard stop).

### Voice (Sprint 6)

The agent speaks its responses using **OmniVoice**
([k2-fsa/OmniVoice](https://huggingface.co/k2-fsa/OmniVoice)), an existing
local TTS setup found running in this machine's WSL Ubuntu distro (an
OpenAI-compatible `/v1/audio/speech` HTTP server, `omnivoice-server`, in a
venv at `~/omnivoice-env`). Start it before running `npm run dev`:

```bash
wsl -d Ubuntu-24.04
source ~/omnivoice-env/bin/activate
omnivoice-server --host 0.0.0.0 --port 8765 --device cuda   # or --device cpu
```

Reachable from Windows at `http://localhost:8765` via WSL2's automatic
localhost forwarding — no extra networking setup needed. `ffplay`/`ffmpeg`
must also be on the Windows `PATH` (used for real-time PCM playback).

**GPU note**: this machine's GPU (RTX 4070, 12GB) is tight when both Ollama
(the 30B-A3B model) and OmniVoice run on CUDA simultaneously - it was
observed pushing VRAM to ~11.6/12.3GB and destabilizing Ollama (slow
responses, occasional container restarts). `--device cpu` for OmniVoice is
slower per utterance (~2s synthesis for a short sentence vs sub-second on
GPU) but avoids fighting Ollama for VRAM - reasonable default if both run
on the same box. If voice is not needed, `AYMI_VOICE=0` skips it entirely;
if the server isn't reachable at all, aymi degrades gracefully to text-only
with a one-time console warning rather than breaking the turn loop.

### Running the Evaluation Harness

```bash
npm run eval
```

Runs every case in `src/evaluation/cases/` against a fresh session on the
real runtime (real Ollama calls, real tools) and prints a section-29-style
report per case plus a pass/fail summary; exits non-zero if any case
failed. Takes a few minutes — one case deliberately forces a real tool
timeout (see below) and every case is a handful of real LLM round-trips.

### Running the browser front end (Sprint 7)

Two processes, in separate terminals:

```bash
npm run server        # backend: WebSocket bridge on :8787, wraps the same AgentRuntime as the CLI
cd ui && npm run dev   # frontend: Vite dev server on :5173
```

Open `http://localhost:5173`. The CLI (`npm run dev`) keeps working exactly
as before and is unaffected - `server.ts` is just another presentation
consumer of the same runtime, the same way `main.ts` is (section 4/45).
Audio still plays on the host machine via `ffplay`/OmniVoice, same as the
CLI; the browser never receives audio bytes, only the *events* (including
PCM amplitude for lip sync).

### Running as a Desktop Avatar Overlay (Tauri)

The browser front end above runs in an ordinary browser tab - useful for
quick iteration, but it can't be transparent, click-through, always-on-top,
or placed on a specific monitor, because a browser tab isn't a native
window. `ui/src-tauri/` wraps the same React app in a real Tauri 2 desktop
window that can do all of that, without changing `AgentRuntime`,
`server.ts`, the WS protocol, `PresentationStateMachine`, or
`AnimationController` - the overlay is still just another presentation
consumer of the same runtime.

```bash
npm run server         # backend: same WebSocket bridge as above, :8787
cd ui && npx tauri dev  # native overlay window instead of a browser tab
```

- **Two modes, toggled with `Ctrl+Shift+A`, no restart:** overlay mode
  (default) is transparent, borderless, always-on-top, and click-through -
  mouse input passes through to whatever is behind it. Config mode makes
  the window interactive: the full chat UI (header/status/chat input)
  appears, the header can be dragged to move the window, and a small
  settings panel exposes an always-on-top toggle and (with 2+ monitors) a
  button per monitor to move the window there.
- **Persistence**: position, size, and always-on-top are saved to
  `localStorage` on every move/resize and restored on the next launch
  (`ui/src/overlay/OverlaySettingsStore.ts`).
- **Outside Tauri** (e.g. opening `http://localhost:5173` directly in a
  browser, as used for Browser-pane verification during development),
  `useOverlay()`'s Tauri calls are no-ops and the full chat UI always
  renders - the existing browser-based testing workflow is unaffected.
- **Known limitation**: there's no dedicated resize/scale control yet -
  since `decorations: false` removes the native resize border, resizing
  currently relies on whatever the OS/window manager allows programmatically;
  a scale slider in `OverlaySettingsPanel` would be the natural next step.
- Files: `ui/src-tauri/` (Rust shell: window config in `tauri.conf.json`,
  the `Ctrl+Shift+A` global-shortcut toggle in `src/lib.rs`),
  `ui/src/overlay/` (`useOverlay.ts`, `OverlaySettingsStore.ts`,
  `tauriEnv.ts`), `ui/src/components/OverlaySettingsPanel.tsx`.

### Running voice input (Sprint 8, per `docs/specs/KIRA_VOICE_INTEGRATION_SPEC.md`)

Off by default - needs a working microphone and the vendored whisper.cpp
build (see that spec doc's own section for the full design; this is a
quick-start plus what's actually been verified with real speech).

```bash
AYMI_VOICE_INPUT=1 npm run server   # AYMI_MIC_DEVICE overrides the mic (see below)
```

Say `"Kira, <comando>"` - e.g. **"Kira, que horas são?"** - out loud near the
mic. `AgentRuntime` processes it exactly like typed/WS text (same
`handleInput()`), so anything that requires confirmation (most action
tools - `open_application`, `write_file`, etc.) will sit waiting for an
approval that only a connected UI (the Tauri overlay or the browser front
end) can give, same as it already does for typed input - have one open if
you want those to actually complete instead of hanging.

- Find your mic's exact device name with:
  `ffmpeg -list_devices true -f dshow -i dummy` (look for the `(audio)`
  entries), then set `AYMI_MIC_DEVICE="Exact Name"` if it's not
  `"Microfone (G733 Gaming Headset)"` (this machine's default).
- STT model: `AYMI_WHISPER_MODEL` overrides the path (default
  `vendor/whisper.cpp/models/ggml-small.bin`). The smaller `ggml-base.bin`
  was tried first and hallucinated too much on real speech ("Kira, que
  horas são?" came out as "que oração") - `small` fixed that for plain
  Portuguese but still occasionally mangles English loanwords like
  "Chrome" ("crômi", "cronca") - an inherent STT limitation, not a pipeline
  bug (see the wake-word note below and TC-VOICE-003 in the spec, which
  explicitly expects the *Agent Runtime* to absorb this kind of noise, not
  the voice module).
- **Verified live**, in order: mic capture + VAD + transcription (this
  machine's `ffmpeg` build has `--enable-whisper`, so one persistent
  `ffmpeg -f dshow ... -af whisper=...:vad_model=...` process does capture,
  VAD, and transcription together - see `WhisperFfmpegSTT.ts`); wake-word
  detection (fuzzy-matched by edit distance in `WakeWord.ts`, since pt-BR
  Whisper output renders "Kira" inconsistently - "Quira", "Queira", "Cira"
  were all observed live - an exact-match alias list turned into
  whack-a-mole, so it's Levenshtein distance ≤1 against a short seed list
  instead); command forwarding into the exact same turn pipeline as typed
  input; and the Agent Runtime handling a good transcription correctly
  ("Kira, que horas são?" → `SUCCESS: São 11:31:55...`) *and* a bad one
  sensibly ("Kira, abriu crômi" → `ASK_USER: Você quis dizer o Google
  Chrome? Posso tentar abri-lo para você.` - exactly TC-VOICE-003's
  intent, with zero Chrome-specific code in the voice module).
- **"Kira, abre o Chrome" (TC-VOICE-001) fully closed the loop**: the STT
  never transcribes "Chrome" correctly in a pt-BR sentence ("cron", "cromi",
  "crome", "cronca" - all different takes of the same word), and a
  character-edit-distance fuzzy match against installed app names actively
  picked the *wrong* app ("cron" is spelling-closer to "Cross Tools
  Command Prompt" than to "Chrome", despite sounding like it - phonetic
  similarity isn't spelling similarity). Fixed properly: a new
  `list_installed_apps` tool (`InstalledApps.ts`, enumerating real Start
  Menu shortcuts - no hardcoded app list) lets the *LLM itself* resolve the
  mis-transcription, since it's better at "sounds like X" judgment calls
  than a hand-rolled distance metric. Confirmed live: `open_application`
  was called with the correct `chrome.exe` path, the confirmation dialog
  appeared, Chrome launched on approval - only the turn's *last* step
  (GoalEvaluator) separately hit Groq's free-tier rate limit (8000 TPM,
  easy to hit with `list_installed_apps`' ~150-app payload in context) and
  reported the turn as FAILED even though the actual requested action had
  already succeeded - a reporting quirk, not a functional one.
- **Voice identity**: OmniVoice's default (`voice: "auto"`) is male - Kira
  is a female character, so the default is now the `nova` preset (female,
  young adult) instead. `OMNIVOICE_VOICE` still overrides it; see
  `/v1/voices` on the OmniVoice server for the full preset list plus
  `design:<attributes>` for custom voice design.
- Not done: barge-in (spec section 15 - voice-detected interruption of
  Kira's own speech; typed-message barge-in already works, see
  `SpeechController`), telemetry fields (section 19), a dedicated
  wake-word engine (this is still "Modo A" per section 8 - continuous STT,
  just with real VAD baked in rather than the bare minimum that section
  describes), voice-based confirmation ("sim"/"pode" per section 21 - right
  now only a connected UI's confirm button works), and the `TTSProvider`
  abstraction (sections 3-4 - `SpeechController` still calls
  `OmniVoiceClient` directly; low priority since `AgentRuntime` already
  never imports voice/TTS code at all).
- Files: `src/voice/profiles/VoiceProfile.ts` (`KIRA_PROFILE`),
  `src/voice/stt/STTProvider.ts` + `WhisperFfmpegSTT.ts`,
  `src/voice/input/WakeWord.ts`, `src/voice/VoiceRuntime.ts` (the section 9
  state machine), wired into `server.ts` behind `AYMI_VOICE_INPUT`.

### Controlling Kira remotely via MCP (e.g. from a phone)

`src/mcp-server.ts` exposes Kira over the Model Context Protocol, so any
MCP-capable client on the same network - a phone running the Claude app,
Claude Desktop, etc. - can talk to her, the same way a browser tab or the
CLI already does.

```bash
npm run mcp   # needs AYMI_MCP_TOKEN set in .env - refuses to start without it
```

- **One tool only: `ask_kira(message)`.** It does *not* expose aymi's
  individual OS tools (`open_application`, `write_file`, ...) directly as
  MCP tools - a connected client calling those straight would bypass the
  Policy Engine entirely. `ask_kira` routes everything through the exact
  same `runTurn()` used by the CLI/WS bridge/voice, so every existing
  safety property (risk-based confirmation, the deterministic Policy
  Engine, tracing) applies exactly as it already does today - this is just
  one more presentation consumer of the same runtime.
- **Confirmation over MCP** uses the protocol's `elicitation/create`
  request: when a tool call needs approval, the server asks the *connected
  client* to collect a yes/no from the human (via `Confirm`'s existing
  `elicitInput` call), instead of hanging forever like a confirmation
  requested over voice/WS with nothing there to answer it. If the client
  doesn't support elicitation (or the request fails), it degrades to a
  safe deny rather than hanging.
- **Auth**: every request needs `Authorization: Bearer <AYMI_MCP_TOKEN>` -
  being on the same LAN isn't access control by itself, and some of these
  tools have real side effects (this was flagged as a real risk while
  designing this, not an afterthought).
- **Session handling**: Streamable HTTP transport, following the SDK's own
  reference session-management pattern (one transport per `mcp-session-id`,
  reused across requests - the first naive version recreated a transport
  per HTTP request and broke after `initialize`).
- Verified live: a raw MCP `initialize` → `notifications/initialized` →
  `tools/call` sequence against `ask_kira` returned a correct answer
  through the real Groq-backed pipeline. Confirmation-requiring commands
  (the elicitation round-trip) still need a real interactive MCP client to
  fully verify - not something a plain HTTP request can drive end to end.
- To connect: point the client at `http://<this machine's LAN IP>:8790/`
  with that bearer token. Exact steps depend on the client (Claude.ai's
  Connectors, Claude Desktop's MCP config, etc.).

## What Sprints 1–7 actually do

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
10. Every step (`INTENT`, `PLAN`, `POLICY_CHECK`, `TOOL_REQUEST` — recorded
    the moment the LLM *proposes* a call, before any policy decision —
    `POLICY_DECISION`, `TOOL_STARTED/COMPLETED/FAILED/TIMEOUT/RETRY`,
    `STATE_CHANGED`, `OBSERVATION`, `GOAL_EVALUATION`, `LIMIT_REACHED`,
    `CANCELLED`, ...) is appended to a `Trace` and persisted to
    `storage/aymi.sqlite` (`sessions` / `turns` / `trace_events` tables) —
    the groundwork for the replay feature in section 27, and exactly what
    the Evaluation Harness below asserts against.
11. **The Evaluation Harness** (section 28, `src/evaluation/`) runs a
    `Case` — input, expected intent/tool sequence/forbidden tools/policy
    decision/observations/state transitions/goal state/final response,
    per-case confirm/cancel behavior, cleanup — against the *exact same*
    `runTurn()` the CLI uses (extracted into `runtime/AgentRuntime.ts` so
    there's only one code path to trust), then grades each requirement
    independently as `PASS`/`FAIL`/`NOT_APPLICABLE` (section 29). **A case
    is `FAIL` if any applicable requirement fails — a correct final
    response reached via a wrong trajectory is not a correct execution.**
12. **`SpeechController`** (section 19/32, `src/voice/`) sits entirely
    outside the Agent Runtime — `main.ts` calls `speech.speak(result.finalMessage)`
    *after* `runTurn()` resolves, so the Evaluation Harness (which calls
    `runTurn()` directly) never produces audio. The pipeline:
    - `SentenceSegmenter` splits the response into sentence-sized segments,
      so the first one can start playing while later ones are still queued.
    - `OmniVoiceClient` requests each segment with `response_format: "pcm"`
      and `stream: true` - the *only* combination the server actually
      streams (container formats like `wav` need a known total length
      up front, so the server rejects `stream:true` for anything but raw
      PCM) - and returns the sample rate/channels/bit depth read from
      response headers alongside an async generator of raw PCM chunks.
    - `PcmPlayer` feeds those chunks into `ffplay`'s stdin as they arrive,
      so audio starts well before the whole utterance is synthesized
      (observed: first PCM byte at ~0.2s into a request that takes ~2s to
      fully complete).
    - `stop()` aborts the in-flight request and kills `ffplay` immediately.
      **Section 20's barge-in**, adapted for a text-only front end (no STT
      yet - see `voice/interruption/.sprint`, Sprint 8): submitting a new
      message while the agent is still speaking calls `stop()` before the
      next turn starts, the same way detected user speech would.
    - Speech states (`speech.started` / `speech.chunk` / `speech.finished`
      / `speech.interrupted`, section 18) are emitted on the same `EventBus`
      as everything else, visible via `AYMI_DEBUG_EVENTS=1`.
    - Voice degrades gracefully: a fetch failure (server not running) is
      caught, logged once, and the text CLI keeps working normally.

    **Honest scoping note**: section 19's pipeline starts from a *streamed*
    LLM response. `OllamaProvider` currently calls Ollama with
    `stream: false` (simpler tool-call detection against a complete
    response), so segmentation operates on the final response text once a
    turn resolves, not on incrementally arriving tokens. The real streaming/
    queueing benefit this sprint delivers is at the TTS stage itself
    (segment *N+1* can be synthesizing while segment *N* plays) - it isn't
    chained all the way back to token-level LLM streaming.
13. **The browser front end** (`src/server.ts` + `ui/`) is a second
    presentation consumer of the exact same runtime, alongside the CLI -
    it has no agent logic of its own (section 21: "o avatar não deve
    consultar o Agent Runtime... ele recebe eventos"):
    - `server.ts` is a thin WebSocket bridge: it broadcasts every `EventBus`
      emission to connected browsers verbatim, and routes the browser's
      `{type: "input"/"confirm"/"cancel"}` messages into the *same*
      `runTurn()`/`confirm`/`InterruptManager` the CLI uses. The one
      addition beyond the section 18 catalog is a `{type: "response"}`
      message carrying the turn's final text - no EventBus event actually
      carries that (`agent.goal.completed` is `{}`), so rather than stretch
      the shared catalog for one consumer, the bridge sends it as its own
      protocol detail.
    - `ui/src/presentation/PresentationStateMachine.ts` (section 17) maps
      `agent.state.changed` into 9 presentation states
      (IDLE/LISTENING/THINKING/FOCUSED/SPEAKING/WAITING/SUCCESS/ERROR/SURPRISED),
      independent of - and never querying - the Agent Runtime's own FSM.
    - `ui/src/presentation/AnimationController.ts` (section 22) resolves
      what to actually display: an independent "speaking" signal (from
      `speech.*` events) and a "confirmation pending" signal (from
      `confirmation.requested`) can override the base presentation state,
      in priority order `ERROR > CONFIRMATION_REQUIRED > SPEAKING > (base
      state)` - matching section 4's example of the agent being `EXECUTING`
      while the presentation is `FOCUSED + SPEAKING` (FOCUSED is the base
      state, SPEAKING is the overlay). It also owns idle animation (a
      randomized blink timer) and lip sync (mouth openness driven by the
      real RMS amplitude of each PCM chunk, computed in
      `voice/tts/PcmAmplitude.ts` and threaded through `speech.chunk`).
    - `ui/src/components/Avatar.tsx` is a procedural SVG "face" (no Live2D
      model file exists for this project) that reads only
      `{ expression, mouthOpenness, blinking }` and draws - it never touches
      the WebSocket or the runtime's event shapes (section 21's contract).

### Built-in tools

| tool | risk_level | confirmation |
|---|---|---|
| `get_datetime` | `read_only` | none |
| `get_system_information` | `read_only` | none |
| `list_processes` | `read_only` | none |
| `read_file` | `read_only` | none |
| `search_files` | `read_only` | none |
| `open_folder` | `reversible` | required (once per session) |
| `open_application` | `reversible` | required (once per session) |
| `close_application` | `reversible` | required (once per session) |
| `open_url` | `reversible` | required (once per session) |
| `focus_window` | `reversible` | required (once per session) |
| `create_file` | `persistent` | required (once per session) |
| `write_file` | `persistent` | required (once per session) |

Sprint 4 adds the section 11.2 reversible tools and the first section 11.3
persistent ones, all behind the same Policy Engine gate built in Sprint 3:
- `open_application` launches a command (PATH-resolved name or absolute
  path) and distinguishes a real launch from "command not found" with a
  short grace period + exit-code/stderr check — it doesn't just fire-and-
  forget and assume success.
- `close_application` uses `taskkill` **without** `/F` — a deliberately
  graceful-only close. If a process won't close gracefully, that's a
  genuine `FAILURE`, not silently escalated to a force-kill (that's
  `kill_process`, a `destructive` tool, staying out of scope for now).
- `open_url` restricts to `http(s)` and passes the URL as a discrete argv
  element (not a concatenated shell string) to avoid injection.
- `focus_window` shells out to PowerShell's `WScript.Shell.AppActivate`
  (matched by window-title substring), with the user's input escaped as a
  single-quoted PS string literal, never interpolated as code.
- `create_file` uses the `"wx"` flag — it fails with `EEXIST` rather than
  silently overwriting; `write_file` is the explicit overwrite/append tool.

Genuinely `destructive` tools (`delete_file`, `execute_powershell`,
`kill_process`) stay out of this round, since they need more than "the same
confirmation gate, every time" to be trustworthy.

Verified manually against a running Ollama instance and via focused
standalone scripts (bypassing the LLM for deterministic coverage):
- **Goal Evaluator verdicts** — `COMPLETE` (datetime + hostname query);
  `FAIL` (a `search_files` timeout retried automatically, still `UNKNOWN`,
  correctly reported as "insufficient evidence" rather than a guess; a
  `read_file` on a nonexistent path correctly reported failure instead of
  inventing content, R5); `ASK_USER` ("read the config file", no path given,
  followed by a correct continuation from `LISTENING` on the next turn with
  no state-machine error).
- **Policy Engine** — `open_folder`/`open_application`/etc. correctly
  required confirmation; accepting (`s`) ran the tool, declining (`n`)
  produced a clean `CONFIRMATION_DENIED` failure without running anything;
  a second request for the same tool in one session was auto-allowed from
  `session.approvedTools` without re-prompting.
- **Interrupt Manager** — a synthetic slow tool confirmed both halves of
  section 32 directly: cancelling *before* a tool starts rejects immediately
  (`CANCELLED`, no execution); cancelling *while* a cancellable tool is
  running aborts it promptly (~300ms into a simulated 5s operation) instead
  of waiting it out.
- **New Sprint 4 tools, end to end**: `open_application("XyzNaoExiste999")`
  failed fast and clearly (not a false success); `open_application("notepad")`
  launched it (verified via `list_processes`); `close_application` closed it
  gracefully; `focus_window("notepad")` correctly *failed* (this machine's
  PT-BR Windows names the window "Bloco de Notas", not "notepad" —
  a real substring miss, not a bug) while `focus_window("Bloco de Notas")`
  correctly succeeded; `create_file` → `create_file` again on the same path
  correctly refused (`EEXIST`) → `write_file(mode: "append")` → `read_file`
  round-tripped exactly to the expected `"hello world"`; `open_url` opened a
  real page in the default browser.

**Evaluation Harness** — `npm run eval` runs 9 cases (positive multi-tool,
knowledge-not-found, tool-failure, a genuine forced timeout/`UNKNOWN`,
policy-denied, ambiguous→`ASK_USER`, application-not-found, and mid-turn
cancellation) against the real runtime. Getting there took two real fixes
surfaced by the harness itself, not the harness being adjusted to fit the
code:
- `ToolExecutor.reject()` (used for `POLICY_DENIED`/`CONFIRMATION_DENIED`)
  never recorded `TOOL_REQUEST`, so a denied call vanished from the trace's
  tool-call sequence entirely. Fixed by moving `TOOL_REQUEST` recording up
  into `AgentRuntime.runTurn()`, once per call the LLM *proposes* —
  regardless of what the Policy Engine decides next — matching section 18's
  distinction between `tool.requested` and `tool.started`/`completed`.
- Ollama returned `400 exceed_context_size_error` mid-suite, twice: once
  because nothing ever requested a context window bigger than Ollama's
  4096-token default, and again because a broad `search_files` result
  serialized verbatim into conversation history was enough to blow even an
  8192-token window. Fixed both: `OllamaProvider` always sends
  `options.num_ctx` (16384 by default), and every tool result is capped at
  `maxToolResultChars` before being added to conversation history (section
  31's `max_context`, finally implemented) — the Goal Evaluator reasons from
  the Observation Manager's summary anyway, not the raw JSON.

**Known, honestly-reported flakiness**: `ambiguous_request_ask_user` ("read
the config file", no path given) does not pass every run — across several
observed runs it correctly asked for clarification about half the time and
guessed at a path (or otherwise claimed completion) the other half. This is
genuine model non-determinism on a genuinely ambiguous prompt, not a runtime
bug: the Goal Evaluator's ASK_USER logic worked correctly in every run where
it triggered, including the state machine correctly continuing from
`LISTENING` on the next turn. Rather than tuning the prompt until this one
case reliably passes (overfitting to the eval, not improving general
judgment) or quietly re-running until green, the harness is reporting it as
found — measuring exactly this kind of thing is the point of section 28/29.

One case assertion was also loosened honestly rather than papered over: the
nonexistent-file case originally required `read_file` specifically, but the
model reasonably checked via `search_files` first — a legitimate strategy,
not a bug, so the case now accepts either tool.

**Voice pipeline** — verified end to end against the real OmniVoice server,
with two genuine bugs found and fixed along the way (not worked around):
- `ffplay.stdin.write()` had no `'error'` listener, so a closed pipe (e.g.
  `ffplay` exiting while still being fed audio) was an *unhandled* `'error'`
  event that crashed the whole Node process. Fixed with a listener that
  converts it into "stop feeding this stream", which the write loop's own
  `destroyed`/`exitCode` checks already handled correctly.
- The installed `ffplay` build rejects `-ac <n>` outright
  (`Failed to set value '1' for option 'ac': Option not found` - recent
  FFmpeg builds want `-ch_layout mono`/`stereo` instead of a bare channel
  count). Without this, every `play()` call returned in under 100ms having
  played nothing - a silent failure that would have been easy to miss
  without directly checking `ffplay`'s own stderr.

  Confirmed working after both fixes: a 2-second synthetic tone played for
  the correct ~2.2s (not 74ms); a real turn's response streamed in 4 chunks
  and finished cleanly (`speech.started` → `speech.chunk` × 4 →
  `speech.finished`); typing a second message while the first response was
  still speaking correctly interrupted it (`speech.interrupted` fired
  *before* the second turn's tool call, not after); and stopping the
  OmniVoice server mid-session degraded gracefully to text-only with a
  one-time warning, no crash, turn processing unaffected.

**Browser front end** - driven live through the Browser pane against the
real backend (real Ollama, real tools, real OmniVoice), not a mock:
`agent.state.changed` events correctly walked the avatar/status panel
through `LISTENING → THINKING → FOCUSED → IDLE`; a `get_datetime` call
showed `Tool: get_datetime — Status: COMPLETED` and the chat log rendered
both the user's message and the assistant's reply; the avatar correctly
showed the `speaking` expression during TTS playback (`AnimationController`
overriding the base `idle` state, exactly the section 4 example); a
confirmation-requiring tool correctly rendered the Sim/Não box with the
avatar showing `waiting`, and — left deliberately unanswered — the turn
correctly hit `max_execution_time` and failed cleanly rather than hanging
forever, proving the limits from section 31 apply through this front end
too, not just the CLI.

Two real bugs surfaced and fixed while testing this, not papered over:
- The very first response never reached the browser at all, even though
  `EventBus` events were flowing fine. Cause: the backend process had been
  started *before* the `broadcast({type:"response",...})` line was added to
  `server.ts` - `tsx` doesn't hot-reload a plain script, so the running
  process was still executing the old code. A stale long-running dev
  process masquerading as "the code doesn't work" is exactly the kind of
  thing worth calling out rather than silently restarting past.
- `rl.question()`/`for await` isn't the only place synthetic browser
  input caused confusion: pressing Return in the chat `<input>` didn't
  submit the form during automated testing (a real user pressing Enter
  works fine) - clicking the actual submit button was the reliable signal,
  and is what the verification below relies on.

A third, more serious bug surfaced later (Sprint 8 voice testing, when an
Ollama request failed with an out-of-memory error mid-turn): `runTurn()`
only reset `AgentStateMachine` back to `IDLE` along its normal
SUCCESS/FAILED/ASK_USER/CANCELLED paths - a thrown exception from
anywhere in between (an LLM/tool infra failure, not a normal FAILED
verdict) left the state machine stuck wherever it was interrupted (e.g.
`UNDERSTANDING`), so the *next* turn on that session failed immediately
with `InvalidTransitionError: UNDERSTANDING -> UNDERSTANDING` - the
session was permanently broken until process restart. Fixed by wrapping
the whole turn body in `runTurn()` in a try/catch: every non-terminal
state can reach `CANCELLED`, and every terminal state can reach `IDLE`
(see `TRANSITIONS` in `StateMachine.ts`), so the catch block always has a
valid path back to `IDLE` regardless of exactly where the throw happened,
and returns a normal `FAILED` `TurnResult` instead of propagating the
exception. This is shared by the CLI, the WS bridge, and the eval harness
alike, since they all call the same `runTurn()`.

**Avatar art (partially resolved)**: the user supplied real character
artwork (`ui/src/assets/modelo_base.png`), replacing the procedural SVG
placeholder. It's a single static illustration, not a rigged Live2D model
(no separate hair/eye/mouth layers), so `Avatar.tsx` conveys state through
the same `AnimationController` output applied to the image as a whole - a
colored aura ring per expression, breathing, a speech-amplitude scale
pulse, shake/flash/pop for error/success/surprised, and a brightness dip
for blinking - rather than swapping facial features or animating a rig.
Verified live: the aura correctly turns green with the real artwork during
TTS playback, same as it did with the placeholder. Getting an actual
rigged Live2D character (moving hair, blinking eyes, lip-flap synced to
phonemes) would need either more art from the user (separate layers/poses)
or a proper Live2D Cubism pipeline built around this same art - the
`PresentationStateMachine`/`AnimationController`/`{ expression,
mouthOpenness, blinking }` contract wouldn't need to change either way.

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
│   ├── conversation/    ConversationManager (done)
│   └── AgentRuntime.ts  createAgentRuntime() + runTurn() - the single code
│                        path shared by the CLI and the Evaluation Harness (done)
├── llm/
│   ├── provider/         LLMProvider interface (done)
│   ├── ollama/           OllamaProvider (done)
│   ├── schemas/          structuredCall() forced-tool-call helper (done)
│   └── prompts/          system prompt (done)
├── tools/
│   ├── registry/         ToolDefinition contract + ToolRegistry (done)
│   ├── windows/          get_datetime, get_system_information, open_folder,
│   │                     open_application, close_application, open_url,
│   │                     focus_window (done)
│   ├── process/          list_processes (done)
│   ├── filesystem/       read_file, search_files, create_file, write_file (done)
│   ├── browser/          .sprint — Sprint 4 (browser automation)
│   └── terminal/         .sprint — Sprint 4/5 (destructive: delete_file,
│                         execute_powershell, kill_process)
├── evaluation/
│   ├── cases/            Case type + positive/negative/cancellation cases (done)
│   ├── runner/           EvalRunner - runs a Case against the real runtime (done)
│   ├── assertions/       PASS/FAIL/NOT_APPLICABLE per requirement (done)
│   ├── reports/          section-29-style report formatting (done)
│   └── run.ts            npm run eval entrypoint (done)
├── telemetry/
│   ├── tracing/          Trace (done, now also records STATE_CHANGED)
│   ├── metrics/          .sprint — aggregated metrics beyond the raw trace
│   └── replay/           .sprint — full session reconstruction from persisted trace events
├── voice/
│   ├── tts/              OmniVoiceClient, SentenceSegmenter (done)
│   ├── playback/         PcmPlayer - ffplay-backed streaming playback (done)
│   ├── SpeechController.ts  queue + interruption + speech state events (done)
│   ├── stt/              .sprint — Sprint 8, see docs/specs/KIRA_VOICE_INTEGRATION_SPEC.md
│   └── interruption/     .sprint — Sprint 8 (voice-detected barge-in, needs STT;
│                         typed-message barge-in already works, see SpeechController)
├── server.ts             WebSocket bridge for the browser front end - broadcasts
│                         EventBus events, routes input/confirm/cancel into the
│                         same AgentRuntime/runTurn() as main.ts (done)
└── main.ts               CLI entrypoint wiring it all together (includes a
                           small LineReader - see note below)
ui/                       React + TypeScript (Vite) browser front end (done)
├── src/presentation/     PresentationStateMachine, AnimationController, types (done)
│                         - NB: presentation-layer code lives here, not under
│                         src/presentation/, since it's inherently DOM/React-bound
├── src/components/       Avatar.tsx (real character art - see "Avatar art" note above),
│                         StatusPanel.tsx, ChatInput.tsx, OverlaySettingsPanel.tsx (done)
├── src/overlay/          useOverlay.ts, OverlaySettingsStore.ts, tauriEnv.ts - the
│                         only place the frontend touches Tauri's window APIs (done)
├── src/ws/                useAymiAgent.ts - the only place the frontend talks
│                         to the backend; every component just renders its output (done)
├── src-tauri/            Tauri 2 desktop shell - transparent/borderless/always-on-top
│                         window, Ctrl+Shift+A click-through toggle (done, see
│                         "Running as a Desktop Avatar Overlay" above)
└── src/App.tsx           avatar pane + status pane + chat input, per section 36's mockup (done)
storage/                  SQLite database file lives here (gitignored)
docs/specs/               reference specs for future phases (not yet implemented) -
                          KIRA_VOICE_INTEGRATION_SPEC.md (Sprint 8: wake word, STT, VAD,
                          voice profile, barge-in)
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

- **Sprint 4 (remainder)** — browser automation (DOM/accessibility-tree
  first, per section 35) and `destructive`-risk tools (`delete_file`,
  `execute_powershell`, `kill_process`) — these need more thought than the
  reversible/persistent tools got, since the Policy Engine always requires
  confirmation for them but there's no undo. Each new tool should get an
  eval case, especially the negative ones.
- **Sprint 5 (remainder)** — metrics aggregation and full session replay
  from persisted trace events (section 27); the trace/DB groundwork is
  already there.
- **Sprint 7 (remainder)** — done: `Avatar.tsx` now swaps between 16
  per-expression images sliced from `ui/src/assets/Expressoes.png`
  (`expr-*.png`), including 4 mouth shapes cycled by TTS amplitude for real
  viseme lip sync (`speakingFrame()`) and a dedicated blink pose
  (`expr-piscando.png`) instead of a CSS filter. Still open: a scale
  control in `OverlaySettingsPanel` (see "Running as a Desktop Avatar
  Overlay" above).
- **Sprint 8 (voice, per `docs/specs/KIRA_VOICE_INTEGRATION_SPEC.md`)** —
  "Primeira entrega" (section 25) is wired up: audited first (the existing
  OmniVoice server is TTS-only, confirmed via its `/openapi.json` - no ASR
  endpoints, so a separate STT engine is required per the spec's own
  section 5 guidance). Discovered this machine's `ffmpeg` build has
  `--enable-whisper`: its `whisper` audio filter does mic capture + VAD
  (Silero) + whisper.cpp transcription in one persistent process, writing
  one JSON segment per detected utterance - confirmed to flush in real
  time, not just at process exit, which is what makes a live wake-word
  pipeline possible without hand-rolling VAD or a subprocess-per-utterance.
  `vendor/whisper.cpp`'s `ggml-base.bin` + `ggml-silero-v5.1.2.bin` models
  are used by that filter (whisper.cpp itself isn't invoked directly -
  ffmpeg links it in). New: `STTProvider`/`WhisperFfmpegSTT` (tails the
  filter's JSON output), `VoiceProfile`/`KIRA_PROFILE`, `WakeWord.stripWakeWord()`
  (section 7), and `VoiceRuntime` (section 9's state machine, including
  TC-VOICE-002's "wake word alone -> wait for command"). Wired into
  `server.ts` behind `AYMI_VOICE_INPUT=1` (off by default), forwarding
  recognized commands into the exact same `handleInput()`/`runTurn()` path
  as typed/WS text (section 12), and emitting `voice.state.changed` on the
  EventBus, mapped to the avatar's presentation state in `useAymiAgent.ts`
  (section 16). Smoke-tested: the pipeline starts/stops cleanly against
  the real microphone (`AYMI_MIC_DEVICE` overrides the device name - see
  `ffmpeg -list_devices true -f dshow -i dummy`). **Not yet verified**:
  actual recognition accuracy on a real "Kira, abre o Chrome" utterance
  (TC-VOICE-001) - that needs a human voice to test, which this session
  couldn't do. Also not done: barge-in (section 15), telemetry fields
  (section 19), a dedicated wake-word engine (still "Modo A" per section
  8), and the `TTSProvider` abstraction (sections 3-4 - `SpeechController`
  still calls `OmniVoiceClient` directly; low priority since
  `AgentRuntime` already never imports voice/TTS code at all).
- **Sprint 8** — STT + real voice-triggered barge-in (`voice/stt/`,
  `voice/interruption/`); typed-message barge-in already works today.
