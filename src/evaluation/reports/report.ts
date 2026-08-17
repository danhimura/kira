import type { CaseRunResult } from "../runner/EvalRunner.js";

const LABEL_WIDTH = 28;

/** Renders one case in the section-29 style table (requirement dots verdict). */
export function formatCaseReport(result: CaseRunResult): string {
  const lines = [`Case: ${result.case.id} — ${result.case.description}`];

  for (const r of result.results) {
    if (r.verdict === "NOT_APPLICABLE") continue; // section 29 example omits N/A rows; keep the table focused on what was actually graded
    const dots = ".".repeat(Math.max(1, LABEL_WIDTH - r.requirement.length));
    const detail = r.detail ? ` (${r.detail})` : "";
    lines.push(`  ${r.requirement} ${dots} ${r.verdict}${detail}`);
  }

  lines.push(`CASE = ${result.verdict}`);
  return lines.join("\n");
}

export function formatSuiteReport(results: CaseRunResult[]): string {
  const sections = results.map(formatCaseReport);
  const passed = results.filter((r) => r.verdict === "PASS").length;
  const summary = `\n${passed}/${results.length} cases passed.`;
  return [...sections, summary].join("\n\n");
}
