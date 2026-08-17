// Section 2/23 of docs/specs/KIRA_VOICE_INTEGRATION_SPEC.md - Kira's voice
// identity lives here, not scattered across the TTS/STT call sites.
export interface VoiceProfile {
  id: string;
  wakeWord: string;
  /**
   * Transcription variants of the wake word to also match. "Kira" isn't a
   * native Portuguese sound - confirmed live that pt-BR Whisper output
   * consistently renders it as "Quira" (the /k/ becomes "qu", the usual
   * Portuguese spelling for that phoneme). Matching only the literal
   * "kira" spelling meant the wake word never fired.
   */
  wakeWordAliases: string[];
  language: string;
  ttsProvider: "omnivoice";
  ttsVoice: string;
  sttProvider: "whisper-ffmpeg";
  sttModel: string;
}

export const KIRA_PROFILE: VoiceProfile = {
  id: "kira",
  wakeWord: "kira",
  wakeWordAliases: ["kira", "quira", "kyra", "chira", "cira"],
  language: "pt",
  ttsProvider: "omnivoice",
  ttsVoice: "nova",
  sttProvider: "whisper-ffmpeg",
  sttModel: "small",
};
