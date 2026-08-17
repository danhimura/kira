import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { DEFAULT_LIMITS } from "./runtime/session/Limits.js";
import { ToolExecutor } from "./runtime/executor/ToolExecutor.js";
import { InterruptManager } from "./runtime/interrupt/InterruptManager.js";
import { createAgentRuntime, runTurn, describeLlmProvider, type Confirm } from "./runtime/AgentRuntime.js";
import { SpeechController } from "./voice/SpeechController.js";
import { VoiceRuntime } from "./voice/VoiceRuntime.js";
import { WhisperFfmpegSTT } from "./voice/stt/WhisperFfmpegSTT.js";
import { KIRA_PROFILE } from "./voice/profiles/VoiceProfile.js";

const PORT = Number(process.env.AYMI_SERVER_PORT ?? 8787);
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";
const VOICE_ENABLED = process.env.AYMI_VOICE !== "0";
const OMNIVOICE_BASE_URL = process.env.OMNIVOICE_BASE_URL ?? "http://localhost:8765";
const OMNIVOICE_VOICE = process.env.OMNIVOICE_VOICE ?? "nova";
// Sprint 8 (docs/specs/KIRA_VOICE_INTEGRATION_SPEC.md) - off by default since
// it needs a working microphone and the vendored whisper.cpp build/models;
// AYMI_MIC_DEVICE overrides the dshow device name (see `ffmpeg -list_devices
// true -f dshow -i dummy` to find yours).
const VOICE_INPUT_ENABLED = process.env.AYMI_VOICE_INPUT === "1";

/**
 * Section 37/45 - the browser front end (Sprint 7) is *a* presentation
 * consumer of the Agent Runtime, same as the CLI (main.ts): both call the
 * identical createAgentRuntime()/runTurn(), and this file's only job is
 * transporting EventBus events to the browser over WebSocket and routing
 * the browser's input/confirm/cancel back in - it has no agent logic of
 * its own. Audio still plays locally via SpeechController/ffplay, same as
 * the CLI; the browser only ever receives speech *events* (including PCM
 * amplitude for lip sync), never the audio bytes themselves.
 */
const runtime = createAgentRuntime({ ollamaHost: OLLAMA_HOST, ollamaModel: OLLAMA_MODEL });
const session = runtime.sessions.createSession();
const executor = new ToolExecutor(runtime.registry, runtime.events, session.id);
const speech = new SpeechController(runtime.events, session.id, {
  enabled: VOICE_ENABLED,
  baseUrl: OMNIVOICE_BASE_URL,
  voice: OMNIVOICE_VOICE,
});
const voiceRuntime = VOICE_INPUT_ENABLED
  ? new VoiceRuntime({
      profile: KIRA_PROFILE,
      stt: new WhisperFfmpegSTT({ language: KIRA_PROFILE.language }),
      onCommand: (text) => {
        console.log(`[voz] comando reconhecido: "${text}"`);
        void handleInput(text);
      },
      onStateChanged: (state) => {
        console.log(`[voz] estado: ${state}`);
        runtime.events.emit("voice.state.changed", session.id, { state });
      },
    })
  : undefined;

const clients = new Set<WebSocket>();
let activeInterrupt: InterruptManager | undefined;
let pendingConfirm: { resolve: (approved: boolean) => void } | undefined;
let processingTurn = false;

function broadcast(message: unknown): void {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

runtime.events.on("*", (event) => {
  broadcast({ type: "event", event });
});

const confirm: Confirm = (message, signal) =>
  new Promise<boolean>((resolve, reject) => {
    pendingConfirm = { resolve };
    const onAbort = () => {
      pendingConfirm = undefined;
      const err = new Error("Aborted");
      err.name = "AbortError";
      reject(err);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

async function handleInput(text: string): Promise<void> {
  if (processingTurn) {
    broadcast({ type: "error", message: "Já existe uma solicitação em andamento." });
    return;
  }

  if (speech.isSpeaking()) speech.stop(); // barge-in, same as the CLI

  processingTurn = true;
  const interrupt = new InterruptManager();
  activeInterrupt = interrupt;
  console.log(`[input] "${text}"`);
  try {
    const result = await runTurn(runtime, session, executor, text, DEFAULT_LIMITS, interrupt, confirm, { quiet: true });
    console.log(`[outcome] ${result.outcome}: ${result.finalMessage}`);
    // Not part of the section 18 EventBus catalog - the runtime's events
    // never carry the actual response text (agent.goal.completed is `{}`),
    // so the WS bridge sends it as its own protocol message instead of
    // stretching the shared event catalog to fit one presentation consumer.
    broadcast({ type: "response", text: result.finalMessage, outcome: result.outcome });
    void speech.speak(result.finalMessage);
  } catch (err) {
    console.error(`[erro no turno]`, err);
    broadcast({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    activeInterrupt = undefined;
    processingTurn = false;
  }
}

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "hello", tools: runtime.registry.list().map((t) => t.name) }));

  ws.on("message", (raw) => {
    let msg: { type: string; text?: string; approved?: boolean };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "input" && typeof msg.text === "string") {
      void handleInput(msg.text);
    } else if (msg.type === "confirm" && typeof msg.approved === "boolean") {
      pendingConfirm?.resolve(msg.approved);
      pendingConfirm = undefined;
    } else if (msg.type === "cancel") {
      activeInterrupt?.requestCancel();
      speech.stop();
    }
  });

  ws.on("close", () => clients.delete(ws));
});

httpServer.listen(PORT, () => {
  console.log(`aymi server (Sprint 7) listening on http://localhost:${PORT} (WebSocket at /ws)`);
  console.log(`Modelo: ${describeLlmProvider(OLLAMA_MODEL, OLLAMA_HOST)}`);
  console.log(`Ferramentas registradas: ${runtime.registry.list().map((t) => t.name).join(", ")}`);
  if (voiceRuntime) {
    console.log(`Voz (entrada): ativada - diga "${KIRA_PROFILE.wakeWord}, <comando>" (AYMI_VOICE_INPUT=1)`);
    void voiceRuntime.start().catch((err) => console.error("[voz] falha ao iniciar captura:", err));
  } else {
    console.log('Voz (entrada): desativada (AYMI_VOICE_INPUT=1 para ativar - requer microfone + vendor/whisper.cpp)');
  }
});

process.on("SIGINT", () => {
  activeInterrupt?.requestCancel();
  speech.stop();
  void voiceRuntime?.stop();
  runtime.sessions.closeSession(session);
  httpServer.close();
  process.exit(0);
});
