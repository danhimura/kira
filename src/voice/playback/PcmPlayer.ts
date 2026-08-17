import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Writable } from "node:stream";

type FfplayProcess = ChildProcessByStdio<Writable, null, null>;

/** ffplay's `-ch_layout` wants a layout name/mask, not a bare channel count (recent FFmpeg builds reject `-ac <n>` outright - "Option not found"). */
function channelLayout(channels: number): string {
  if (channels === 1) return "mono";
  if (channels === 2) return "stereo";
  return String(channels);
}

/**
 * Plays a live stream of raw PCM audio via `ffplay`, fed chunk-by-chunk as
 * they arrive - this is what actually makes streaming synthesis translate
 * into audio starting before the whole utterance has been generated.
 * `stop()` kills playback immediately (section 32 - tool/interrupt
 * cancellation, applied to speech).
 */
export class PcmPlayer {
  private current: FfplayProcess | undefined;

  async play(chunks: AsyncIterable<Buffer>, sampleRate: number, channels: number, bitDepth: number): Promise<void> {
    if (bitDepth !== 16) {
      throw new Error(`PcmPlayer only supports 16-bit PCM, got ${bitDepth}-bit`);
    }

    const ffplay = spawn(
      "ffplay",
      [
        "-f",
        "s16le",
        "-ar",
        String(sampleRate),
        "-ch_layout",
        channelLayout(channels),
        "-nodisp",
        "-autoexit",
        "-loglevel",
        "quiet",
        "-i",
        "pipe:0",
      ],
      { stdio: ["pipe", "ignore", "ignore"] }
    );
    this.current = ffplay;

    // ffplay can exit early (bad format, no audio device, killed by stop())
    // while we're still trying to write to its stdin - without a listener,
    // that EPIPE/EOF write error is an unhandled 'error' event and crashes
    // the whole process. A no-op listener converts it into "just stop
    // writing", which the write-loop's own destroyed/exitCode checks handle.
    ffplay.stdin.on("error", () => {});

    const closed = new Promise<void>((resolve) => {
      ffplay.once("close", () => resolve());
      ffplay.once("error", () => resolve());
    });

    try {
      for await (const chunk of chunks) {
        if (ffplay.stdin.destroyed || ffplay.exitCode !== null) break;
        try {
          const canWriteMore = ffplay.stdin.write(chunk);
          if (!canWriteMore) {
            await new Promise<void>((resolve) => ffplay.stdin.once("drain", resolve));
          }
        } catch {
          break;
        }
      }
    } finally {
      if (!ffplay.stdin.destroyed) {
        try {
          ffplay.stdin.end();
        } catch {
          /* already gone */
        }
      }
    }

    await closed;
    if (this.current === ffplay) this.current = undefined;
  }

  /** Kills playback immediately - used for barge-in and hard stop. */
  stop(): void {
    if (this.current && this.current.exitCode === null) {
      this.current.kill();
    }
    this.current = undefined;
  }
}
