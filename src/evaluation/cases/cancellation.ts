import type { EvalCase } from "./Case.js";

export const cancellationCases: EvalCase[] = [
  {
    id: "user_cancels_mid_turn",
    description: "Section 32 - a soft cancel after the first tool call must stop before the second",
    input: "Diga as horas atuais e depois liste os processos com nome contendo chrome",
    cancelAfterToolCalls: 1,
    expectedObservationStatuses: ["SUCCESS"],
    expectedOutcome: "CANCELLED",
  },
];
