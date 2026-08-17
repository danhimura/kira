// Section 5 of docs/specs/KIRA_VOICE_INTEGRATION_SPEC.md - STT kept behind
// its own interface, independent of TTSProvider, so the engine underneath
// (currently ffmpeg's built-in whisper.cpp filter) can be swapped later.
export interface TranscribedSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface STTProvider {
  start(onSegment: (segment: TranscribedSegment) => void, onError: (err: Error) => void): Promise<void>;
  stop(): Promise<void>;
}
