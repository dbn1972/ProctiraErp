import type { AssignmentKind, AssignmentStatus, LmsScope, SubmissionStatus } from '@/lib/api/lms';
import { cn } from '@/lib/utils';

const STATUS_COLOURS: Record<AssignmentStatus, string> = {
  draft: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  published: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  closed: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  archived: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

const SUBMISSION_COLOURS: Record<SubmissionStatus, string> = {
  submitted: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  late: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  graded: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  returned: 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400',
};

const KIND_COLOURS: Record<AssignmentKind, string> = {
  assignment: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
  homework: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  quiz: 'bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-950/40 dark:text-fuchsia-300',
};

const SCOPE_COLOURS: Record<LmsScope, string> = {
  board: 'border-violet-300 text-violet-700 dark:border-violet-700 dark:text-violet-300',
  school: 'border-teal-300 text-teal-700 dark:border-teal-700 dark:text-teal-300',
};

const pill = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold';

export function StatusPill({ status, label }: { status: AssignmentStatus; label: string }) {
  return <span className={cn(pill, STATUS_COLOURS[status])}>{label}</span>;
}

export function SubmissionPill({ status, label }: { status: SubmissionStatus; label: string }) {
  return <span className={cn(pill, SUBMISSION_COLOURS[status])}>{label}</span>;
}

export function KindPill({ kind, label }: { kind: AssignmentKind; label: string }) {
  return <span className={cn(pill, KIND_COLOURS[kind])}>{label}</span>;
}

export function ScopePill({ scope, label }: { scope: LmsScope; label: string }) {
  return <span className={cn(pill, 'border bg-transparent', SCOPE_COLOURS[scope])}>{label}</span>;
}
