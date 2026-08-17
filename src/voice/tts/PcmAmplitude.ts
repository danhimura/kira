/**
 * Section 19's "Lip Sync" pipeline stage needs *something* to drive mouth
 * openness from. Rather than a fake toggle, this computes the RMS amplitude
 * of each raw 16-bit PCM chunk as it streams past, normalized to 0..1 -
 * genuine audio-driven lip sync (not phoneme/viseme-level, but real signal,
 * not a guess) that the presentation layer (Sprint 7) can consume directly.
 */
export function computeRmsAmplitude16(pcm: Buffer): number {
  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount === 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = pcm.readInt16LE(i * 2) / 32768;
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / sampleCount);
  // RMS of a full-scale sine wave is ~0.707; scale so typical speech peaks
  // land near 1.0 without every chunk clipping to the ceiling.
  return Math.min(1, rms * 2.5);
}
