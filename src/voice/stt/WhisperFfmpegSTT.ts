import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";
import type { STTProvider, TranscribedSegment } from "./STTProvider.js";

export interface WhisperFfmpegOptions {
  micDevice?: string;
  modelPath?: string;
  vadModelPath?: string;
  language?: string;
  tmpDir?: string;
}

/**
 * STTProvider backed by this machine's ffmpeg build, which has whisper.cpp
 * compiled in as an audio filter (`ffmpeg -h filter=whisper`) - it captures
 * the microphone, runs VAD (Silero, ggml-*.bin), and transcribes each
 * detected speech segment, all in one persistent process. Rather than
 * hand-rolling mic capture + VAD + a whisper-cli subprocess-per-utterance,
 * this reuses that single ffmpeg feature end to end.
 *
 * ffmpeg writes one JSON object per line to `destination` as each VAD
 * segment finishes transcribing (confirmed live, not just at process exit
 * - see the "escreve em tempo real" check during Sprint 8 development).
 * There's no stdout/stdin pipe for this output, so it's tailed by polling
 * the file's size and reading only the newly-appended bytes.
 */
export class WhisperFfmpegSTT implements STTProvider {
  private proc: ChildProcess | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private readOffset = 0;
  private carry = "";
  private readonly destPath: string;

  constructor(private readonly opts: WhisperFfmpegOptions = {}) {
    const tmpDir = opts.tmpDir ?? "storage/voice-tmp";
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
    // Relative, forward-slashed path: ffmpeg's filtergraph parser treats ':'
    // as a reserved separator inside filter option values, which breaks on
    // an absolute Windows path's drive-letter colon (confirmed while
    // testing - "C:/Users/..." fails to parse, a plain relative path doesn't).
    this.destPath = path.join(tmpDir, `segments-${Date.now()}.ndjson`).split(path.sep).join("/");
  }

  async start(onSegment: (segment: TranscribedSegment) => void, onError: (err: Error) => void): Promise<void> {
    const micDevice = this.opts.micDevice ?? process.env.AYMI_MIC_DEVICE ?? "Microfone (G733 Gaming Headset)";
    const modelPath = this.opts.modelPath ?? process.env.AYMI_WHISPER_MODEL ?? "vendor/whisper.cpp/models/ggml-small.bin";
    const vadModelPath = this.opts.vadModelPath ?? "vendor/whisper.cpp/models/ggml-silero-v5.1.2.bin";
    const language = this.opts.language ?? "pt";

    const filter =
      `whisper=model=${modelPath}:language=${language}:vad_model=${vadModelPath}` +
      `:destination=${this.destPath}:format=json:queue=15:use_gpu=false`;

    this.proc = spawn("ffmpeg", ["-loglevel", "error", "-f", "dshow", "-i", `audio=${micDevice}`, "-af", filter, "-f", "null", "-"]);

    this.proc.on("error", onError);
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (/error/i.test(text)) onError(new Error(text.trim()));
    });
    this.proc.on("exit", (code) => {
      if (code !== null && code !== 0) onError(new Error(`ffmpeg (voice capture) exited with code ${code}`));
    });

    this.pollTimer = setInterval(() => this.poll(onSegment), 300);
  }

  private poll(onSegment: (segment: TranscribedSegment) => void): void {
    if (!existsSync(this.destPath)) return;
    const size = statSync(this.destPath).size;
    if (size <= this.readOffset) return;

    const length = size - this.readOffset;
    const buf = Buffer.alloc(length);
    const fd = openSync(this.destPath, "r");
    readSync(fd, buf, 0, length, this.readOffset);
    closeSync(fd);
    this.readOffset = size;

    const lines = (this.carry + buf.toString("utf8")).split("\n");
    this.carry = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = JSON.parse(trimmed) as { start: number; end: number; text: string };
      onSegment({ startMs: parsed.start, endMs: parsed.end, text: parsed.text });
    }
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.proc?.kill();
    this.proc = undefined;
  }
}
