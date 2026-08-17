import { positiveCases } from "./positive.js";
import { negativeCases } from "./negative.js";
import { cancellationCases } from "./cancellation.js";
import type { EvalCase } from "./Case.js";

export const allCases: EvalCase[] = [...positiveCases, ...negativeCases, ...cancellationCases];

export type { EvalCase };
