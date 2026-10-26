/**
 * PRC-M551: exit-code decision for the DoD aggregator baseline gate.
 *
 *   0 — within baseline / clean run
 *   1 — new error debt beyond baseline (or --strict warning regression), or
 *       `--update-baseline` wrote error entries without a reason
 *   2 — the baseline file is missing (fail closed; pass --no-baseline or
 *       --update-baseline explicitly)
 *
 * Kept pure so the matrix is unit-tested without spawning the CLI.
 */
export function resolveExitCode({
  noBaseline,
  updateBaseline,
  strict,
  totals,
  comparison,
  baselineMissing,
  unreasonedAfterUpdate,
}) {
  if (updateBaseline) return unreasonedAfterUpdate > 0 ? 1 : 0;
  if (noBaseline) {
    return totals.totalErrors > 0 || (strict && totals.totalWarnings > 0) ? 1 : 0;
  }
  if (baselineMissing) return 2;
  return comparison?.ok ? 0 : 1;
}
