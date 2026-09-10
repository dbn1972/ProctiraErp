'use client';

/**
 * G-902 — working controls for the examination Candidates / Results /
 * Documents tabs (previously inert buttons): register a candidate, upload
 * marks (CSV), publish results, generate documents.
 */
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Download, FileText, Loader2, Plus, Upload } from 'lucide-react';

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@proctira/ui/components';
import {
  generateDocumentsAction,
  publishResultsAction,
  recordMarksAction,
  registerCandidateAction,
  type ActionState,
} from '@/app/(dashboard)/examinations/actions';
import type {
  Examination,
  ExaminationDocumentType,
  ExaminationSubject,
} from '@/lib/api/examinations';
import { useHydrated } from '@/hooks/useHydrated';
import { marksCsvTemplate, parseMarksCsv } from '@/lib/examinations/marks-csv';

function Feedback({ state }: { state: ActionState | null }) {
  if (!state || state.status === 'idle') return null;
  return (
    <p
      role={state.status === 'error' ? 'alert' : 'status'}
      className={state.status === 'error' ? 'text-sm text-destructive' : 'text-sm text-emerald-700'}
    >
      {state.message}
    </p>
  );
}

const REGISTRABLE: ReadonlySet<Examination['status']> = new Set(['DRAFT', 'SCHEDULED', 'OPEN']);

export function RegisterCandidateDialog({ examination }: { examination: Examination }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ActionState | null>(null);
  const [selected, setSelected] = useState<string[]>(examination.subjects.map((s) => s.id));
  const [isPending, startTransition] = useTransition();
  const disabled = !REGISTRABLE.has(examination.status);

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const res = await registerCandidateAction({
        examinationId: examination.id,
        studentId: String(formData.get('studentId') ?? '').trim(),
        centerId: String(formData.get('centerId') ?? ''),
        subjectIds: selected,
      });
      setState(res);
      if (res.status === 'success') {
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? `Registration closed (${examination.status})` : undefined}
        data-testid="register-candidate"
        data-hydrated={hydrated ? 'true' : 'false'}
      >
        <Plus className="me-2 h-4 w-4" aria-hidden="true" />
        Register candidate
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-hydrated="true">
          <form action={onSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Register candidate</DialogTitle>
              <DialogDescription>
                Eligibility (active enrollment) is validated by the examination service.
              </DialogDescription>
            </DialogHeader>
            <Feedback state={state} />
            {state?.fieldErrors &&
              Object.entries(state.fieldErrors).map(([field, message]) => (
                <p key={field} className="text-xs text-destructive">
                  {field}: {message}
                </p>
              ))}
            <div className="space-y-1.5">
              <Label htmlFor="candidate-student">Student ID</Label>
              <Input
                id="candidate-student"
                name="studentId"
                required
                placeholder="Student UUID"
                pattern="[0-9a-fA-F-]{36}"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="candidate-center">Centre</Label>
              <select
                id="candidate-center"
                name="centerId"
                required
                className="flex h-9 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue={examination.centers[0]?.id ?? ''}
              >
                {examination.centers.map((center) => (
                  <option key={center.id} value={center.id}>
                    {center.name} ({center.code})
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Subjects</legend>
              {examination.subjects.map((subject) => {
                const checked = selected.includes(subject.id);
                return (
                  <label key={subject.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        setSelected((prev) =>
                          value ? [...prev, subject.id] : prev.filter((id) => id !== subject.id),
                        )
                      }
                      aria-label={subject.name}
                    />
                    {subject.name} <span className="text-muted-foreground">({subject.code})</span>
                  </label>
                );
              })}
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || selected.length === 0}>
                {isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Register
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export interface ResultsControlsProps {
  examination: Examination;
  published: boolean;
  subjects: ExaminationSubject[];
  csv: string;
}

export function ResultsControls({ examination, published, subjects, csv }: ResultsControlsProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [state, setState] = useState<ActionState | null>(null);
  const [isPending, startTransition] = useTransition();
  const preview = useMemo(() => parseMarksCsv(text, subjects), [text, subjects]);
  const canPublish =
    !published && (examination.status === 'IN_PROGRESS' || examination.status === 'COMPLETED');

  const upload = () => {
    if (preview.errors.length > 0 || preview.entries.length === 0) return;
    startTransition(async () => {
      const res = await recordMarksAction({
        examinationId: examination.id,
        entries: preview.entries,
      });
      setState(res);
      if (res.status === 'success') {
        setOpen(false);
        setText('');
        router.refresh();
      }
    });
  };

  const publish = () => {
    startTransition(async () => {
      const res = await publishResultsAction(examination.id);
      setState(res);
      if (res.status === 'success') router.refresh();
    });
  };

  const downloadHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={published}
          title={published ? 'Marks are locked after publication' : undefined}
          data-testid="upload-marks"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <Upload className="me-2 h-4 w-4" aria-hidden="true" />
          Upload marks
        </Button>
        <Button asChild variant="outline" size="sm">
          <a
            href={downloadHref}
            download={`${examination.code}-results.csv`}
            data-testid="download-results"
          >
            <Download className="me-2 h-4 w-4" aria-hidden="true" />
            Download CSV
          </a>
        </Button>
        <Button
          size="sm"
          onClick={publish}
          disabled={!canPublish || isPending}
          title={
            published
              ? 'Already published'
              : canPublish
                ? undefined
                : 'Examination must be IN_PROGRESS or COMPLETED to publish'
          }
          data-testid="publish-results"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          {isPending ? (
            <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="me-2 h-4 w-4" aria-hidden="true" />
          )}
          {published ? 'Published' : 'Publish results'}
        </Button>
      </div>
      <Feedback state={state} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-hydrated="true" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload marks</DialogTitle>
            <DialogDescription>
              Paste CSV with header{' '}
              <code className="rounded bg-muted px-1 text-xs">
                {marksCsvTemplate(subjects).trim()}
              </code>
              . Blank cells mark a subject incomplete.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Marks CSV"
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`${marksCsvTemplate(subjects)}<studentId>,85,55`}
            className="font-mono text-xs"
          />
          {text && preview.errors.length > 0 && (
            <ul role="alert" className="list-disc ps-5 text-xs text-destructive">
              {preview.errors.slice(0, 5).map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          )}
          {text && preview.errors.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {preview.entries.length} candidate rows ready.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={upload}
              disabled={isPending || preview.errors.length > 0 || preview.entries.length === 0}
              data-testid="submit-marks"
            >
              {isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Record marks
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const DOCUMENT_LABELS: Record<ExaminationDocumentType, { title: string; hint: string }> = {
  admit_card: { title: 'Admit cards', hint: 'Scheduled or in-progress exams' },
  seating_plan: { title: 'Seating plan', hint: 'Requires seating allocation' },
  result_certificate: { title: 'Certificates', hint: 'After results are published' },
};

export function GenerateDocumentButtons({ examinationId }: { examinationId: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [state, setState] = useState<ActionState | null>(null);
  const [active, setActive] = useState<ExaminationDocumentType | null>(null);
  const [isPending, startTransition] = useTransition();

  const generate = (type: ExaminationDocumentType) => {
    setActive(type);
    startTransition(async () => {
      const res = await generateDocumentsAction(examinationId, type);
      setState(res);
      setActive(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-3">
        {(Object.keys(DOCUMENT_LABELS) as ExaminationDocumentType[]).map((type) => (
          <Button
            key={type}
            variant="outline"
            className="h-auto flex-col items-start py-4"
            onClick={() => generate(type)}
            disabled={isPending}
            data-testid={`generate-${type}`}
            data-hydrated={hydrated ? 'true' : 'false'}
          >
            {active === type ? (
              <Loader2 className="mb-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileText className="mb-2 h-4 w-4" aria-hidden="true" />
            )}
            <span className="font-semibold">{DOCUMENT_LABELS[type].title}</span>
            <span className="text-xs text-muted-foreground">{DOCUMENT_LABELS[type].hint}</span>
          </Button>
        ))}
      </div>
      <Feedback state={state} />
    </div>
  );
}
