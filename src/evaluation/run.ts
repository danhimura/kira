import { allCases } from "./cases/index.js";
import { runCases } from "./runner/EvalRunner.js";
import { formatSuiteReport } from "./reports/report.js";

async function main() {
  console.log(`Running ${allCases.length} evaluation case(s) against the real Agent Runtime...\n`);
  const results = await runCases(allCases);
  console.log(formatSuiteReport(results));

  const failed = results.filter((r) => r.verdict === "FAIL").length;
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error("Erro fatal ao rodar a suíte de avaliação:", err);
  process.exit(1);
});
