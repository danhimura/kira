/**
 * Section 19 - splits a complete response into sentence-sized segments so
 * the first one can start being synthesized and played while later ones
 * are still queued, instead of waiting for the whole response to be voiced
 * as one giant utterance.
 *
 * Note on scope: section 19's pipeline starts from a *streamed* LLM
 * response ("Response Stream"). Our OllamaProvider currently calls Ollama
 * with stream:false (tool-call detection is simpler against a complete
 * response), so segmentation here operates on the final response text once
 * a turn resolves, not on incrementally arriving tokens. The queueing/
 * streaming benefit this sprint targets is real or at the TTS stage
 * itself (segment N+1 can be synthesizing while segment N plays) - it's
 * just not chained all the way back to token-level LLM streaming yet.
 */
export function segmentIntoSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const matches = trimmed.match(/[^.!?\n]+[.!?]*(\n+|$)/g);
  const segments = (matches ?? [trimmed]).map((s) => s.trim()).filter(Boolean);
  return segments.length ? segments : [trimmed];
}
