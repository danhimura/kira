import type { EvalCase } from "./Case.js";

const noRefusalMarkers = (message: string): boolean =>
  message.length > 0 && !/não sei|desculpe.*não|não consigo/i.test(message);

export const positiveCases: EvalCase[] = [
  {
    id: "positive_datetime",
    description: "Simple single-tool query answered from real tool data",
    input: "Que horas são agora?",
    allowedTools: ["get_datetime"],
    expectedToolSequence: ["get_datetime"],
    expectedObservationStatuses: ["SUCCESS"],
    expectedOutcome: "SUCCESS",
    expectedStateTransitionsContains: [
      "UNDERSTANDING",
      "PLANNING",
      "POLICY_CHECK",
      "EXECUTING",
      "OBSERVING",
      "EVALUATING",
      "SUCCESS",
      "IDLE",
    ],
    finalResponseCheck: noRefusalMarkers,
  },
  {
    id: "positive_multi_tool",
    description: "Two independent read-only tools both contribute to one answer",
    input: "Que horas são agora e qual o hostname desta máquina?",
    allowedTools: ["get_datetime", "get_system_information"],
    expectedObservationStatuses: ["SUCCESS"],
    expectedOutcome: "SUCCESS",
    finalResponseCheck: noRefusalMarkers,
  },
];
