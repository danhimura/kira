export interface TTSOptions {
  voice?: string;
  speed?: number;
}

export interface PcmStream {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  chunks: AsyncGenerator<Buffer>;
}

/**
 * HTTP client for the existing local OmniVoice TTS server (an OpenAI-
 * compatible `/v1/audio/speech` API - k2-fsa/OmniVoice, running in WSL,
 * reachable from Windows via WSL2's localhost forwarding). Kept dumb on
 * purpose (R7 substitutable) - segmentation, queueing, and interruption all
 * live in SpeechController, not here.
 *
 * Streaming requires response_format "pcm": the server rejects streaming
 * for container formats (wav/mp3/...) since those need a known total length
 * up front - raw PCM has none, so it can be delivered as it's synthesized.
 */
export class OmniVoiceClient {
  constructor(private readonly baseUrl: string) {}

  async synthesizeStream(text: string, opts: TTSOptions = {}, signal?: AbortSignal): Promise<PcmStream> {
    const response = await fetch(`${this.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: text,
        voice: opts.voice ?? "auto",
        speed: opts.speed ?? 1,
        response_format: "pcm",
        stream: true,
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => "");
      throw new Error(`OmniVoice request failed (${response.status}): ${body || response.statusText}`);
    }

    const sampleRate = Number(response.headers.get("x-audio-sample-rate") ?? 24000);
    const channels = Number(response.headers.get("x-audio-channels") ?? 1);
    const bitDepth = Number(response.headers.get("x-audio-bit-depth") ?? 16);
    const body = response.body;

    async function* chunks(): AsyncGenerator<Buffer> {
      for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
        yield Buffer.from(chunk);
      }
    }

    return { sampleRate, channels, bitDepth, chunks: chunks() };
  }
}
