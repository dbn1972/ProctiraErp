'use client';

/**
 * G-914 — Students 360 write surfaces on the staff profile:
 * photo upload, ID-card download, siblings, consents, discipline log.
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { IdCard, Loader2, Plus, Upload } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import type {
  ConsentKind,
  DisciplineIncident,
  StudentConsent,
  StudentSibling,
} from '@/lib/api/students';
import {
  addStudentDisciplineAction,
  addStudentSiblingAction,
  setStudentConsentAction,
  uploadStudentPhotoAction,
} from '../actions';

const CONSENT_LABELS: Record<ConsentKind, string> = {
  photo: 'Photo',
  medical: 'Medical',
  trips: 'Trips',
  data_sharing: 'Data sharing',
};

const CONSENT_ORDER: ConsentKind[] = ['photo', 'medical', 'trips', 'data_sharing'];

export interface Student360PanelProps {
  studentId: string;
  hasPhoto: boolean;
  siblings: StudentSibling[];
  consents: StudentConsent[];
  incidents: DisciplineIncident[];
}

export function Student360Panel({
  studentId,
  hasPhoto,
  siblings,
  consents,
  incidents,
}: Student360PanelProps) {
  const hydrated = useHydrated();
  return (
    <div
      className="space-y-4"
      data-testid="student-360"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <PhotoAndIdCard studentId={studentId} hasPhoto={hasPhoto} />
      <ConsentsCard studentId={studentId} consents={consents} />
      <SiblingsCard studentId={studentId} siblings={siblings} />
      <DisciplineCard studentId={studentId} incidents={incidents} />
    </div>
  );
}

function PhotoAndIdCard({ studentId, hasPhoto }: { studentId: string; hasPhoto: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPEG, PNG, or WebP photo.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Photo must be 2 MB or smaller.');
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result;
      setPreview(result);
      startTransition(async () => {
        const outcome = await uploadStudentPhotoAction(studentId, {
          contentBase64: base64,
          mimeType: file.type,
        });
        if (outcome.status === 'error') {
          setError(outcome.message ?? 'Upload failed');
          return;
        }
        router.refresh();
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Photo & ID card</CardTitle>
        <CardDescription className="text-xs">
          Passport photo (JPEG/PNG/WebP, 2 MB) and printable identity card.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span className="relative flex h-16 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
          {preview || hasPhoto ? (
            <img
              alt=""
              src={preview ?? `/api/students/${studentId}/photo`}
              className="h-16 w-16 object-cover"
            />
          ) : null}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          <input
            ref={inputRef}
            id="student-photo-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            data-testid="student-photo-input"
            onChange={(event) => onFile(event.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="student-photo-upload"
            data-hydrated={hydrated ? 'true' : 'false'}
            disabled={isPending}
            title={isPending ? 'Uploading photo' : undefined}
            onClick={() => inputRef.current?.click()}
          >
            {isPending ? (
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="me-1.5 h-4 w-4" aria-hidden="true" />
            )}
            Upload photo
          </Button>
          <Button asChild variant="outline" size="sm">
            <a
              href={`/api/students/${studentId}/id-card`}
              data-testid="student-id-card-download"
              data-hydrated={hydrated ? 'true' : 'false'}
            >
              <IdCard className="me-1.5 h-4 w-4" aria-hidden="true" />
              Download ID card
            </a>
          </Button>
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ConsentsCard({ studentId, consents }: { studentId: string; consents: StudentConsent[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [isPending, startTransition] = useTransition();
  const byKind = new Map(consents.map((c) => [c.kind, c]));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Consents</CardTitle>
        <CardDescription className="text-xs">
          Photo, medical, trips, and data-sharing flags with timestamp and actor.
        </CardDescription>
      </CardHeader>
      <CardContent
        className="space-y-3"
        data-testid="student-consents"
        data-hydrated={hydrated ? 'true' : 'false'}
      >
        {CONSENT_ORDER.map((kind) => {
          const row = byKind.get(kind);
          const granted = row?.granted ?? false;
          return (
            <div key={kind} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{CONSENT_LABELS[kind]}</p>
                <p className="text-xs text-muted-foreground">
                  {row
                    ? `${granted ? 'Granted' : 'Not granted'} · ${row.actorId} · ${row.recordedAt.slice(0, 10)}`
                    : 'Not recorded'}
                </p>
              </div>
              <Switch
                checked={granted}
                disabled={isPending}
                data-testid={`consent-toggle-${kind}`}
                aria-label={`${CONSENT_LABELS[kind]} consent`}
                onCheckedChange={(next) => {
                  startTransition(async () => {
                    await setStudentConsentAction(studentId, { kind, granted: next });
                    router.refresh();
                  });
                }}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function SiblingsCard({ studentId, siblings }: { studentId: string; siblings: StudentSibling[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Siblings</CardTitle>
        <CardDescription className="text-xs">
          Symmetric student-to-student links in this tenant.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {siblings.length === 0 ? (
          <p className="mb-3 text-sm text-muted-foreground" data-testid="siblings-empty">
            No siblings linked yet.
          </p>
        ) : (
          <ul className="mb-3 space-y-1 text-sm" data-testid="siblings-list">
            {siblings.map((row) => (
              <li key={row.id} data-testid="sibling-row" className="font-mono text-xs">
                {row.siblingId}
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-col gap-2 sm:flex-row"
          data-testid="sibling-form"
          data-hydrated={hydrated ? 'true' : 'false'}
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const siblingId = String(new FormData(form).get('siblingId') ?? '');
            setError(null);
            startTransition(async () => {
              const outcome = await addStudentSiblingAction(studentId, { siblingId });
              if (outcome.status === 'error') {
                setError(outcome.message ?? 'Could not link sibling');
                return;
              }
              form.reset();
              router.refresh();
            });
          }}
        >
          <Input
            name="siblingId"
            placeholder="Sibling student ID"
            aria-label="Sibling student ID"
            data-testid="sibling-id"
          />
          <Button
            type="submit"
            size="sm"
            disabled={isPending}
            title={isPending ? 'Linking sibling' : undefined}
          >
            {isPending && <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            Link sibling
          </Button>
        </form>
        {error && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DisciplineCard({
  studentId,
  incidents,
}: {
  studentId: string;
  incidents: DisciplineIncident[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState('low');
  const [visibleToParent, setVisibleToParent] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-sm font-semibold">Discipline log</CardTitle>
          <CardDescription className="text-xs">
            Behaviour incidents with optional parent visibility.
          </CardDescription>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="discipline-add"
          data-hydrated={hydrated ? 'true' : 'false'}
          onClick={() => setOpen(true)}
        >
          <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
          Add incident
        </Button>
      </CardHeader>
      <CardContent>
        {incidents.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="discipline-empty">
            No incidents recorded.
          </p>
        ) : (
          <Table aria-label="Discipline incidents">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Parent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incidents.map((row) => (
                <TableRow key={row.id} data-testid="discipline-row">
                  <TableCell>{row.incidentDate}</TableCell>
                  <TableCell>{row.incidentType}</TableCell>
                  <TableCell className="capitalize">{row.severity}</TableCell>
                  <TableCell>{row.visibleToParent ? 'Visible' : 'Staff only'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            data-testid="discipline-form"
            data-hydrated={hydrated ? 'true' : 'false'}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setError(null);
              startTransition(async () => {
                const outcome = await addStudentDisciplineAction(studentId, {
                  incidentType: String(data.get('incidentType') ?? ''),
                  severity,
                  description: String(data.get('description') ?? ''),
                  actionTaken: String(data.get('actionTaken') ?? ''),
                  incidentDate: String(data.get('incidentDate') ?? ''),
                  visibleToParent,
                });
                if (outcome.status === 'error') {
                  setError(outcome.message ?? 'Could not record incident');
                  return;
                }
                setOpen(false);
                router.refresh();
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Record incident</DialogTitle>
              <DialogDescription>Staff-only unless marked visible to parent.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-4">
              <div className="grid gap-1.5">
                <Label htmlFor="di-type">Incident type</Label>
                <Input id="di-type" name="incidentType" required data-testid="discipline-type" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="di-severity">Severity</Label>
                <Select value={severity} onValueChange={setSeverity}>
                  <SelectTrigger id="di-severity" data-testid="discipline-severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="di-date">Date</Label>
                <Input
                  id="di-date"
                  name="incidentDate"
                  type="date"
                  required
                  data-testid="discipline-date"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="di-desc">Description</Label>
                <Textarea
                  id="di-desc"
                  name="description"
                  required
                  data-testid="discipline-description"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="di-action">Action taken</Label>
                <Input id="di-action" name="actionTaken" data-testid="discipline-action" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={visibleToParent}
                  onCheckedChange={setVisibleToParent}
                  data-testid="discipline-visible-parent"
                />
                Visible to parent
              </label>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="submit"
                size="sm"
                disabled={isPending}
                title={isPending ? 'Saving incident' : undefined}
              >
                {isPending && (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                Save incident
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
