/** Human copy for the institution gradebook. Never surface SQL paths or raw ids. */

export function humanGradebookError(error: string, code?: string): string {
  if (
    code === 'GRADEBOOK_SCHEMA_MISSING' ||
    /db\/sql|db\/seeds|GRADEBOOK_SCHEMA_MISSING|WS2/i.test(error)
  ) {
    return 'Gradebook storage is not set up for this environment yet. Contact your administrator.';
  }
  return 'Gradebook is unavailable right now. Try again, or contact your administrator if this continues.';
}

export function reportCardStatusLabel(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized === 'SUCCEEDED' || normalized === 'COMPLETED' || normalized === 'DONE') {
    return 'Done';
  }
  if (normalized === 'FAILED') return 'Failed';
  if (normalized === 'QUEUED' || normalized === 'RUNNING' || normalized === 'PROCESSING') {
    return 'Queued';
  }
  return status;
}

export function formatGpaSnapshotMessage(input: {
  weightedGpa?: unknown;
  unweightedGpa?: unknown;
  creditsEarned?: unknown;
}): string {
  const weighted = input.weightedGpa ?? 'n/a';
  const unweighted = input.unweightedGpa ?? 'n/a';
  const credits = input.creditsEarned ?? 'n/a';
  return `GPA snapshot saved · weighted ${String(weighted)} · unweighted ${String(unweighted)} · credits ${String(credits)}`;
}

export function workflowPillClass(status: string): string {
  switch (status) {
    case 'PUBLISHED':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400';
    case 'LOCKED':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400';
    case 'APPROVED':
      return 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300';
    case 'SUBMITTED':
      return 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300';
    case 'REJECTED':
      return 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400';
    default:
      return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300';
  }
}
