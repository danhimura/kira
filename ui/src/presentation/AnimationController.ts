import type { Expression, PresentationState } from "./types";

export interface AnimationSnapshot {
  expression: Expression;
  mouthOpenness: number;
  blinking: boolean;
}

const BASE_TO_EXPRESSION: Record<PresentationState, Expression> = {
  IDLE: "idle",
  LISTENING: "listening",
  THINKING: "thinking",
  FOCUSED: "focused",
  SPEAKING: "speaking",
  WAITING: "waiting",
  SUCCESS: "success",
  ERROR: "error",
  SURPRISED: "surprised",
};

/**
 * Section 22 - sits between events and the avatar renderer. The base
 * presentation state doesn't get the final say on what's displayed: an
 * independent "speaking" signal (from speech.* events, not from
 * PresentationStateMachine) and a "confirmation pending" signal can
 * override it, in priority order:
 *
 *   ERROR > CONFIRMATION_REQUIRED > SPEAKING > (base state, e.g. FOCUSED/THINKING/IDLE)
 *
 * This is also what section 4's "agent EXECUTING while presentation is
 * FOCUSED + SPEAKING" example is describing: FOCUSED is the base state,
 * SPEAKING is an overlay this controller resolves on top of it - never two
 * competing base states at once.
 *
 * Idle behavior (blinking) lives here too, since deciding when the avatar
 * blinks/moves without being told to is exactly "animation controller"
 * territory (section 22: idle animation, blink, olhar), not something the
 * runtime or the state machine should know about.
 */
export class AnimationController {
  private baseState: PresentationState = "IDLE";
  private speaking = false;
  private confirmationPending = false;
  private mouthOpenness = 0;
  private blinking = false;
  private readonly listeners = new Set<(snapshot: AnimationSnapshot) => void>();
  private blinkTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.scheduleBlink();
  }

  setBaseState(state: PresentationState): void {
    this.baseState = state;
    this.emit();
  }

  setSpeaking(speaking: boolean): void {
    this.speaking = speaking;
    if (!speaking) this.mouthOpenness = 0;
    this.emit();
  }

  setConfirmationPending(pending: boolean): void {
    this.confirmationPending = pending;
    this.emit();
  }

  /** Section 19 lip sync - amplitude (0..1) from the currently-playing PCM chunk. Ignored when not speaking. */
  setMouthAmplitude(amplitude: number): void {
    if (!this.speaking) return;
    this.mouthOpenness = Math.max(0, Math.min(1, amplitude));
    this.emit();
  }

  dispose(): void {
    if (this.blinkTimer) clearTimeout(this.blinkTimer);
  }

  subscribe(listener: (snapshot: AnimationSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private resolveExpression(): Expression {
    if (this.baseState === "ERROR") return "error";
    if (this.confirmationPending) return "waiting";
    if (this.speaking) return "speaking";
    return BASE_TO_EXPRESSION[this.baseState];
  }

  private scheduleBlink(): void {
    const delay = 2000 + Math.random() * 3000;
    this.blinkTimer = setTimeout(() => {
      this.blinking = true;
      this.emit();
      setTimeout(() => {
        this.blinking = false;
        this.emit();
        this.scheduleBlink();
      }, 150);
    }, delay);
  }

  private snapshot(): AnimationSnapshot {
    return { expression: this.resolveExpression(), mouthOpenness: this.mouthOpenness, blinking: this.blinking };
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
