import type { STTProvider, TranscribedSegment } from "./stt/STTProvider.js";
import type { VoiceProfile } from "./profiles/VoiceProfile.js";
import { stripWakeWord } from "./input/WakeWord.js";

// Section 9 of docs/specs/KIRA_VOICE_INTEGRATION_SPEC.md.
export type VoiceState =
  | "VOICE_IDLE"
  | "LISTENING_FOR_WAKE"
  | "WAKE_DETECTED"
  | "CAPTURING_COMMAND"
  | "TRANSCRIBING"
  | "COMMAND_READY"
  | "FORWARDING"
  | "AUDIO_ERROR"
  | "TIMEOUT";

export interface VoiceRuntimeOptions {
  profile: VoiceProfile;
  stt: STTProvider;
  onCommand: (text: string) => void;
  onStateChanged?: (state: VoiceState) => void;
  /** TC-VOICE-002: "Kira." alone - how long to wait for the command that follows. */
  captureCommandTimeoutMs?: number;
}

/**
 * Section 1/11/12 - this class only ever produces plain command text handed
 * to onCommand(); it never inspects *what* the command means or calls a
 * tool itself. The caller is expected to forward that text into the exact
 * same AgentRuntime.runTurn() path as typed input (server.ts's handleInput),
 * so voice and text are indistinguishable to the runtime.
 */
export class VoiceRuntime {
  private state: VoiceState = "VOICE_IDLE";
  private captureTimeout: NodeJS.Timeout | undefined;

  constructor(private readonly opts: VoiceRuntimeOptions) {}

  async start(): Promise<void> {
    this.setState("LISTENING_FOR_WAKE");
    await this.opts.stt.start(
      (segment) => this.onSegment(segment),
      (err) => this.onError(err)
    );
  }

  async stop(): Promise<void> {
    this.clearCaptureTimeout();
    await this.opts.stt.stop();
    this.setState("VOICE_IDLE");
  }

  private onSegment(segment: TranscribedSegment): void {
    const text = segment.text.trim();
    if (!text) return;
    console.log(`[voz] segmento (${this.state}): "${text}"`);

    if (this.state === "CAPTURING_COMMAND") {
      // Already past the wake word (TC-VOICE-002) - whatever comes next is
      // the command, no repeated "Kira" prefix required.
      this.clearCaptureTimeout();
      this.deliverCommand(text);
      return;
    }

    const { detected, command } = stripWakeWord(text, this.opts.profile.wakeWordAliases);
    if (!detected) return; // ambient speech not addressed to Kira - ignore, per section 22

    this.setState("WAKE_DETECTED");
    if (command) {
      this.deliverCommand(command);
    } else {
      this.setState("CAPTURING_COMMAND");
      this.captureTimeout = setTimeout(() => {
        this.setState("TIMEOUT");
        this.setState("LISTENING_FOR_WAKE");
      }, this.opts.captureCommandTimeoutMs ?? 15000);
    }
  }

  private deliverCommand(command: string): void {
    this.setState("TRANSCRIBING");
    this.setState("COMMAND_READY");
    this.setState("FORWARDING");
    this.opts.onCommand(command);
    this.setState("LISTENING_FOR_WAKE");
  }

  private onError(err: Error): void {
    this.setState("AUDIO_ERROR");
    console.error(`[voz] erro na captura/STT: ${err.message}`);
  }

  private clearCaptureTimeout(): void {
    if (this.captureTimeout) clearTimeout(this.captureTimeout);
    this.captureTimeout = undefined;
  }

  private setState(state: VoiceState): void {
    this.state = state;
    this.opts.onStateChanged?.(state);
  }
}
