// Section 13 of docs/specs/KIRA_VOICE_INTEGRATION_SPEC.md distinguishes
// internal/tool-status text from what's actually meant to be spoken - this
// covers the other half of that: the LLM's own Markdown formatting
// (**bold**, `code`, [links](url), # headers) is meant for a chat UI, not a
// voice. Left as-is, OmniVoice either speaks the literal symbols or produces
// odd results (confirmed live: "**H₂O**" wasn't spoken correctly). A light
// regex pass, not a full Markdown parser - good enough for what an LLM
// actually produces in a spoken response.
const SUBSCRIPT_DIGITS: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };
const SUPERSCRIPT_DIGITS: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "") // fenced code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/__([^_]+)__/g, "$1") // bold (underscore)
    .replace(/\*([^*]+)\*/g, "$1") // italic
    .replace(/_([^_]+)_/g, "$1") // italic (underscore)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links - keep the label
    .replace(/^#{1,6}\s+/gm, "") // headers
    .replace(/^[-*+]\s+/gm, "") // bullet list markers
    .replace(/^\d+\.\s+/gm, "") // numbered list markers
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (d) => SUBSCRIPT_DIGITS[d])
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (d) => SUPERSCRIPT_DIGITS[d])
    .trim();
}
