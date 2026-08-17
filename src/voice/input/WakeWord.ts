// Section 7 of docs/specs/KIRA_VOICE_INTEGRATION_SPEC.md - detects the "Kira"
// prefix and strips it before the command reaches the Agent Runtime. Pure
// text in, text out: no tool/command interpretation happens here (section 11
// forbids that in the voice module).
export interface WakeWordResult {
  detected: boolean;
  command: string;
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// "Kira" isn't a native Portuguese sound - pt-BR Whisper output has been
// observed rendering it as "Quira", "Quire", "Cira", each a different take
// of the same utterance. An exact-match alias list turned into permanent
// whack-a-mole, so the first word is instead fuzzy-matched (edit distance
// <= 1) against a short list of the transcription patterns actually seen -
// tolerates single-letter slips without matching unrelated words (ordinary
// short Portuguese words like "que" are far outside distance 1).
export function stripWakeWord(text: string, wakeWordAliases: string[], maxDistance = 1): WakeWordResult {
  const trimmed = text.trim();
  const match = /^([\p{L}]+)([\s,.:;!?-]*)([\s\S]*)$/u.exec(trimmed);
  if (!match) return { detected: false, command: "" };

  const [, firstWord, , rest] = match;
  const firstWordLower = firstWord.toLowerCase();
  const isWake = wakeWordAliases.some((alias) => levenshtein(firstWordLower, alias.toLowerCase()) <= maxDistance);

  if (!isWake) return { detected: false, command: "" };
  return { detected: true, command: rest.trim() };
}
