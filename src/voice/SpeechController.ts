import type { EventBus } from "../runtime/events/EventBus.js";
import { OmniVoiceClient } from "./tts/OmniVoiceClient.js";
import { PcmPlayer } from "./playback/PcmPlayer.js";
import { segmentIntoSentences } from "./tts/SentenceSegmenter.js";
import { sanitizeForSpeech } from "./tts/SpeechSanitizer.js";
import { computeRmsAmplitude16 } from "./tts/PcmAmplitude.js";

export interface SpeechControllerOptions {
  baseUrl?: string;
  voice?: string;
  enabled?: boolean;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Section 19/32 - the TTS pipeline (segment -> synthesize -> play,
 * sentence by sentence) plus interruption, sitting entirely outside the
 * Agent Runtime (section 45 - TTS is a downstream consumer of a turn's
 * result, not part of producing it). AgentRuntime/runTurn never imports
 * this - main.ts calls speak() after a turn resolves, so eval harness runs
 * (which call runTurn directly) never produce audio.
 *
 * Voice is meant to degrade gracefully: if the TTS server isn't reachable,
 * playback is skipped with a one-time warning rather than breaking the
 * (still fully functional) text CLI.
 */
export class SpeechController {
  private readonly client: OmniVoiceClient;
  private readonly player = new PcmPlayer();
  private readonly enabled: boolean;
  private readonly voice: string | undefined;
  private controller: AbortController | undefined;
  private warnedUnavailable = false;

  constructor(
    private readonly events: EventBus,
    private readonly sessionId: string,
    options: SpeechControllerOptions = {}
  ) {
    this.enabled = options.enabled ?? true;
    this.voice = options.voice;
    this.client = new OmniVoiceClient(options.baseUrl ?? "http://localhost:8765");
  }

  isSpeaking(): boolean {
    return this.controller !== undefined;
  }

  /** Section 32 - stop TTS playback immediately (typed-message barge-in, Ctrl+C, hard stop). */
  stop(): void {
    this.controller?.abort();
    this.player.stop();
  }

  /** Speaks text sentence-by-sentence; stop() interrupts mid-utterance. Never throws - degrades to a logged warning. */
  async speak(text: string): Promise<void> {
    if (!this.enabled) return;
    const segments = segmentIntoSentences(sanitizeForSpeech(text));
    if (!segments.length) return;

    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;

    this.events.emit("speech.started", this.sessionId, { text });
    try {
      for (const segment of segments) {
        if (signal.aborted) break;
        await this.speakSegment(segment, signal);
      }
      this.events.emit(signal.aborted ? "speech.interrupted" : "speech.finished", this.sessionId, {});
    } catch (err) {
      if (isAbortError(err)) {
        this.events.emit("speech.interrupted", this.sessionId, {});
      } else {
        this.warnUnavailable(err);
      }
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }

  private async speakSegment(text: string, signal: AbortSignal): Promise<void> {
    const stream = await this.client.synthesizeStream(text, { voice: this.voice }, signal);
    const emitChunk = (bytes: number, amplitude: number) =>
      this.events.emit("speech.chunk", this.sessionId, { bytes, amplitude });

    async function* tap(source: AsyncGenerator<Buffer>): AsyncGenerator<Buffer> {
      for await (const chunk of source) {
        emitChunk(chunk.length, computeRmsAmplitude16(chunk));
        yield chunk;
      }
    }

    await this.player.play(tap(stream.chunks), stream.sampleRate, stream.channels, stream.bitDepth);
  }

  private warnUnavailable(err: unknown): void {
    if (this.warnedUnavailable) return;
    this.warnedUnavailable = true;
    console.warn(`[voz] TTS indisponível, continuando em modo texto: ${err instanceof Error ? err.message : String(err)}`);
  }
}
