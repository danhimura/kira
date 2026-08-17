/**
 * Section 32 - the three cancellation levels map onto one shared AbortSignal
 * per turn: requestCancel() (soft cancel) stops new planning/actions at
 * every check point in main.ts's cycle loop, and the same signal is handed
 * to ToolExecutor so a cancellable, in-flight tool call can actually abort
 * (tool cancel) instead of only being ignored after the fact. Hard stop
 * (killing the whole runtime) is handled separately by main.ts's SIGINT
 * handler, outside any single turn.
 */
export class InterruptManager {
  private readonly controller = new AbortController();

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  isCancelRequested(): boolean {
    return this.controller.signal.aborted;
  }

  requestCancel(): void {
    this.controller.abort();
  }
}
