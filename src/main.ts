import { createInterface } from "node:readline";
import { DEFAULT_LIMITS } from "./runtime/session/Limits.js";
import { ToolExecutor } from "./runtime/executor/ToolExecutor.js";
import { InterruptManager } from "./runtime/interrupt/InterruptManager.js";
import { createAgentRuntime, runTurn, describeLlmProvider, type Confirm } from "./runtime/AgentRuntime.js";
import { SpeechController } from "./voice/SpeechController.js";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";
const VOICE_ENABLED = process.env.AYMI_VOICE !== "0";
const OMNIVOICE_BASE_URL = process.env.OMNIVOICE_BASE_URL ?? "http://localhost:8765";
const OMNIVOICE_VOICE = process.env.OMNIVOICE_VOICE ?? "nova";

const runtime = createAgentRuntime({ ollamaHost: OLLAMA_HOST, ollamaModel: OLLAMA_MODEL });

runtime.events.on("*", (event) => {
  if (process.env.AYMI_DEBUG_EVENTS) {
    console.log(`  [event] ${event.name}`, JSON.stringify(event.data));
  }
});

/**
 * Reads lines on demand from a readline.Interface, one at a time, safely
 * interleaving the main input prompt with confirmation prompts.
 *
 * Neither of Node's two built-in consumption styles fits: `rl.question()`
 * only arms a one-shot `line` listener per call, so lines that arrive
 * before the *next* question() call (e.g. piped/redirected input, which
 * readline can flush faster than the consumer re-arms) are silently
 * dropped; and `for await...of rl` is documented as unsafe to mix with
 * concurrent `rl.question()` calls. Buffering every `line` event ourselves
 * and handing them out on demand avoids both failure modes and works the
 * same way for a real interactive TTY.
 */
class LineReader {
  private readonly buffer: string[] = [];
  private readonly waiting: Array<{ resolve: (line: string) => void; reject: (err: unknown) => void }> = [];

  constructor(rl: import("node:readline").Interface) {
    rl.on("line", (line: string) => {
      const pending = this.waiting.shift();
      if (pending) pending.resolve(line);
      else this.buffer.push(line);
    });
    rl.on("close", () => {
      while (this.waiting.length) {
        const err = new Error("Interface closed");
        (err as NodeJS.ErrnoException).code = "ERR_USE_AFTER_CLOSE";
        this.waiting.shift()!.reject(err);
      }
    });
  }

  next(promptText: string, signal?: AbortSignal): Promise<string> {
    process.stdout.write(promptText);

    if (this.buffer.length) return Promise.resolve(this.buffer.shift()!);

    return new Promise<string>((resolve, reject) => {
      const entry = { resolve, reject };
      const onAbort = () => {
        const idx = this.waiting.indexOf(entry);
        if (idx !== -1) this.waiting.splice(idx, 1);
        const err = new Error("Aborted");
        err.name = "AbortError";
        reject(err);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(entry);
    });
  }
}

async function main(): Promise<void> {
  console.log("aymi - Agent Runtime (Sprint 6)");
  console.log(`Modelo: ${describeLlmProvider(OLLAMA_MODEL, OLLAMA_HOST)}`);
  console.log(`Ferramentas registradas: ${runtime.registry.list().map((t) => t.name).join(", ")}`);
  console.log(
    VOICE_ENABLED
      ? `Voz: OmniVoice @ ${OMNIVOICE_BASE_URL} (voice="${OMNIVOICE_VOICE}") - AYMI_VOICE=0 para desativar`
      : "Voz: desativada (AYMI_VOICE=0)"
  );
  console.log('Digite sua mensagem (ou "sair" para encerrar). Ctrl+C cancela a operação atual; Ctrl+C de novo encerra o programa.\n');

  const session = runtime.sessions.createSession();
  const executor = new ToolExecutor(runtime.registry, runtime.events, session.id);
  const speech = new SpeechController(runtime.events, session.id, {
    enabled: VOICE_ENABLED,
    baseUrl: OMNIVOICE_BASE_URL,
    voice: OMNIVOICE_VOICE,
  });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lineReader = new LineReader(rl);

  const shutdown = () => {
    speech.stop();
    runtime.sessions.closeSession(session);
    try {
      rl.close();
    } catch {
      /* already closed */
    }
    // Set the exit code and let Node drain pending handles on its own -
    // process.exit() can race libuv's own handle-close teardown on Windows.
    process.exitCode = 0;
  };

  // Section 32 - first Ctrl+C is a soft cancel of whatever turn is running
  // (and stops any ongoing speech); a second Ctrl+C (or one with nothing
  // running) is a hard stop.
  let activeInterrupt: InterruptManager | undefined;
  process.on("SIGINT", () => {
    if (activeInterrupt && !activeInterrupt.isCancelRequested()) {
      activeInterrupt.requestCancel();
      speech.stop();
      console.log("\n[cancelamento solicitado - Ctrl+C novamente para encerrar o programa]");
    } else {
      shutdown();
    }
  });

  const confirm: Confirm = async (message, signal) => {
    const answer = (await lineReader.next(message, signal)).trim().toLowerCase();
    return answer === "s" || answer === "sim" || answer === "y" || answer === "yes";
  };

  while (true) {
    let raw: string;
    try {
      raw = await lineReader.next("> ");
    } catch (err) {
      // stdin reached EOF (e.g. piped/redirected input) while awaiting a line.
      if ((err as NodeJS.ErrnoException)?.code === "ERR_USE_AFTER_CLOSE") break;
      throw err;
    }

    const input = raw.trim();
    if (!input) continue;
    if (input.toLowerCase() === "sair" || input.toLowerCase() === "exit") break;

    // Section 20 barge-in, adapted for a text-only front end: submitting a
    // new message while the agent is still speaking interrupts it, the same
    // way detected user speech would. Real voice-triggered barge-in needs
    // STT (Sprint 8) - see voice/interruption/.sprint.
    if (speech.isSpeaking()) speech.stop();

    const interrupt = new InterruptManager();
    activeInterrupt = interrupt;
    const result = await runTurn(runtime, session, executor, input, DEFAULT_LIMITS, interrupt, confirm);
    activeInterrupt = undefined;

    // Fire-and-forget: don't block the next prompt on speech finishing.
    void speech.speak(result.finalMessage);
  }

  shutdown();
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
