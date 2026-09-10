'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import {
  allocateInvigilatorAction,
  assignReevaluationAction,
  completeReevaluationAction,
  createExamSessionAction,
  generateSeatingAction,
  recordDoubleEntryAction,
  requestReevaluationAction,
  resolveMarksAction,
  type ActionState,
} from '@/app/(dashboard)/examinations/actions';
import { useHydrated } from '@/hooks/useHydrated';
import type {
  ExamOpsInvigilator,
  ExamOpsMarksPair,
  ExamOpsReevaluation,
  ExamOpsSeat,
  ExamOpsSession,
  Examination,
} from '@/lib/api/examinations';

function Feedback({ state }: { state: ActionState | null }) {
  if (!state || state.status === 'idle') return null;
  return (
    <p
      role={state.status === 'error' ? 'alert' : 'status'}
      className={state.status === 'error' ? 'text-sm text-destructive' : 'text-sm text-emerald-700'}
      data-testid="exam-ops-feedback"
    >
      {state.message}
    </p>
  );
}

export interface ExamOpsPanelProps {
  examination: Examination;
  sessions: ExamOpsSession[];
  invigilatorsBySession: Record<string, ExamOpsInvigilator[]>;
  seats: ExamOpsSeat[];
  marks: ExamOpsMarksPair[];
  reevaluations: ExamOpsReevaluation[];
}

export function ExamOpsPanel({
  examination,
  sessions,
  invigilatorsBySession,
  seats,
  marks,
  reevaluations,
}: ExamOpsPanelProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState | null>(null);

  const run = (fn: () => Promise<ActionState>) => {
    startTransition(async () => {
      const result = await fn();
      setState(result);
      if (result.status === 'success') router.refresh();
    });
  };

  return (
    <div
      className="space-y-6"
      data-testid="exam-ops-panel"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <Feedback state={state} />

      <Card data-testid="exam-sessions-card">
        <CardHeader>
          <CardTitle className="text-base">Sessions & invigilators</CardTitle>
          <CardDescription>
            Allocate staff to a session. Overlapping staff or room bookings are rejected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="create-session-form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const centerId = String(data.get('centerId') ?? '');
              run(() =>
                createExamSessionAction({
                  examinationId: examination.id,
                  subjectId: String(data.get('subjectId') ?? ''),
                  date: String(data.get('date') ?? ''),
                  startTime: String(data.get('startTime') ?? ''),
                  endTime: String(data.get('endTime') ?? ''),
                  roomId: String(data.get('roomId') ?? ''),
                  centerId: centerId || undefined,
                }),
              );
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="ops-subject">Subject</Label>
              <select
                id="ops-subject"
                name="subjectId"
                required
                className="flex h-9 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue={examination.subjects[0]?.id ?? ''}
              >
                {examination.subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ops-date">Date</Label>
              <Input id="ops-date" name="date" type="date" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ops-start">Start</Label>
              <Input id="ops-start" name="startTime" type="time" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ops-end">End</Label>
              <Input id="ops-end" name="endTime" type="time" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ops-room">Room</Label>
              <Input id="ops-room" name="roomId" required placeholder="HALL-A" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ops-center">Centre</Label>
              <select
                id="ops-center"
                name="centerId"
                className="flex h-9 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue={examination.centers[0]?.id ?? ''}
              >
                {examination.centers.map((center) => (
                  <option key={center.id} value={center.id}>
                    {center.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={isPending} data-testid="create-session">
                {isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Add session
              </Button>
            </div>
          </form>

          {sessions.length === 0 ? (
            <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
              No sessions yet.
            </p>
          ) : (
            <Table aria-label="Exam sessions">
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Room</TableHead>
                  <TableHead>Invigilators</TableHead>
                  <TableHead>Allocate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id} data-testid="exam-session-row">
                    <TableCell>
                      {session.date} {session.startTime}–{session.endTime}
                    </TableCell>
                    <TableCell>{session.roomId}</TableCell>
                    <TableCell>
                      {(invigilatorsBySession[session.id] ?? []).map((inv) => (
                        <code key={inv.id} className="me-1 text-xs">
                          {inv.staffId.slice(0, 8)}
                        </code>
                      ))}
                    </TableCell>
                    <TableCell>
                      <form
                        className="flex gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const data = new FormData(event.currentTarget);
                          run(() =>
                            allocateInvigilatorAction({
                              examinationId: examination.id,
                              sessionId: session.id,
                              staffId: String(data.get('staffId') ?? ''),
                            }),
                          );
                        }}
                      >
                        <Input
                          name="staffId"
                          required
                          placeholder="Staff UUID"
                          pattern="[0-9a-fA-F-]{36}"
                          aria-label={`Staff for session ${session.roomId}`}
                        />
                        <Button
                          type="submit"
                          size="sm"
                          disabled={isPending}
                          data-testid="allocate-invigilator"
                        >
                          Assign
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card data-testid="exam-seating-card">
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Seating</CardTitle>
            <CardDescription>
              Persisted seating plan (30 seats per room per centre).
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => run(() => generateSeatingAction(examination.id))}
            disabled={isPending}
            data-testid="generate-seating"
          >
            {isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {seats.length > 0 ? 'Regenerate' : 'Generate seating'}
          </Button>
        </CardHeader>
        <CardContent>
          {seats.length === 0 ? (
            <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
              No seating plan yet.
            </p>
          ) : (
            <Table aria-label="Seating plan">
              <TableHeader>
                <TableRow>
                  <TableHead>Seat</TableHead>
                  <TableHead>Room</TableHead>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Centre</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {seats.map((seat) => (
                  <TableRow key={seat.id} data-testid="exam-seat-row">
                    <TableCell>{seat.seatNumber}</TableCell>
                    <TableCell>{seat.roomNumber}</TableCell>
                    <TableCell>
                      <code className="text-xs">{seat.studentName}</code>
                    </TableCell>
                    <TableCell>{seat.centerName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card data-testid="exam-marks-card">
        <CardHeader>
          <CardTitle className="text-base">Marks double entry</CardTitle>
          <CardDescription>
            First and second entry must be different users. Variance is flagged when the difference
            exceeds the tolerance; a moderator resolves the final mark.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
            data-testid="double-entry-form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              run(() =>
                recordDoubleEntryAction({
                  examinationId: examination.id,
                  candidateId: String(data.get('candidateId') ?? ''),
                  subjectId: String(data.get('subjectId') ?? ''),
                  entryNo: Number(data.get('entryNo')) === 2 ? 2 : 1,
                  marks: Number(data.get('marks')),
                }),
              );
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="marks-candidate">Candidate ID</Label>
              <Input id="marks-candidate" name="candidateId" required pattern="[0-9a-fA-F-]{36}" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="marks-subject">Subject</Label>
              <select
                id="marks-subject"
                name="subjectId"
                className="flex h-9 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue={examination.subjects[0]?.id ?? ''}
              >
                {examination.subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.code}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="marks-entry">Entry</Label>
              <select
                id="marks-entry"
                name="entryNo"
                className="flex h-9 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue="1"
              >
                <option value="1">First</option>
                <option value="2">Second</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="marks-value">Marks</Label>
              <Input id="marks-value" name="marks" type="number" min={0} required />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={isPending} data-testid="submit-double-entry">
                Record entry
              </Button>
            </div>
          </form>

          {marks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No double-entry marks yet.</p>
          ) : (
            <Table aria-label="Double marks entries">
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>1st</TableHead>
                  <TableHead>2nd</TableHead>
                  <TableHead>Variance</TableHead>
                  <TableHead>Final</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {marks.map((pair) => (
                  <TableRow
                    key={`${pair.candidateId}:${pair.subjectId}`}
                    data-testid="marks-pair-row"
                  >
                    <TableCell>
                      <code className="text-xs">{pair.candidateId.slice(0, 8)}</code>
                    </TableCell>
                    <TableCell>{pair.entry1?.marks ?? '—'}</TableCell>
                    <TableCell>{pair.entry2?.marks ?? '—'}</TableCell>
                    <TableCell>
                      {pair.varianceFlag ? (
                        <Badge variant="destructive" data-testid="variance-badge">
                          Variance {pair.variance}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">OK</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {pair.resolved ? (
                        pair.finalMarks
                      ) : pair.entry1 && pair.entry2 ? (
                        <form
                          className="flex gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const data = new FormData(event.currentTarget);
                            run(() =>
                              resolveMarksAction({
                                examinationId: examination.id,
                                candidateId: pair.candidateId,
                                subjectId: pair.subjectId,
                                finalMarks: Number(data.get('finalMarks')),
                              }),
                            );
                          }}
                        >
                          <Input
                            name="finalMarks"
                            type="number"
                            min={0}
                            required
                            className="w-20"
                            aria-label="Final marks"
                          />
                          <Button type="submit" size="sm" data-testid="resolve-marks">
                            Resolve
                          </Button>
                        </form>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card data-testid="exam-reeval-card">
        <CardHeader>
          <CardTitle className="text-base">Re-evaluation</CardTitle>
          <CardDescription>
            Request → assign evaluator → complete with revised marks (delta is audited).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            data-testid="reeval-request-form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const original = String(data.get('originalMarks') ?? '');
              run(() =>
                requestReevaluationAction({
                  examinationId: examination.id,
                  candidateId: String(data.get('candidateId') ?? ''),
                  subjectId: String(data.get('subjectId') ?? ''),
                  originalMarks: original ? Number(original) : undefined,
                  notes: String(data.get('notes') ?? '') || undefined,
                }),
              );
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="reeval-candidate">Candidate ID</Label>
              <Input id="reeval-candidate" name="candidateId" required pattern="[0-9a-fA-F-]{36}" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reeval-subject">Subject</Label>
              <select
                id="reeval-subject"
                name="subjectId"
                className="flex h-9 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue={examination.subjects[0]?.id ?? ''}
              >
                {examination.subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.code}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reeval-original">Original marks</Label>
              <Input id="reeval-original" name="originalMarks" type="number" min={0} />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={isPending} data-testid="request-reevaluation">
                Request
              </Button>
            </div>
          </form>

          {reevaluations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No re-evaluation requests.</p>
          ) : (
            <Table aria-label="Re-evaluation requests">
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Marks</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reevaluations.map((row) => (
                  <TableRow key={row.id} data-testid="reeval-row">
                    <TableCell>
                      <Badge>{row.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">{row.candidateId.slice(0, 8)}</code>
                    </TableCell>
                    <TableCell>
                      {row.originalMarks ?? '—'}
                      {row.revisedMarks !== null ? ` → ${row.revisedMarks}` : ''}
                    </TableCell>
                    <TableCell>
                      {row.status === 'requested' ? (
                        <form
                          className="flex gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const data = new FormData(event.currentTarget);
                            run(() =>
                              assignReevaluationAction({
                                examinationId: examination.id,
                                requestId: row.id,
                                evaluatorId: String(data.get('evaluatorId') ?? ''),
                              }),
                            );
                          }}
                        >
                          <Input
                            name="evaluatorId"
                            required
                            placeholder="Evaluator UUID"
                            pattern="[0-9a-fA-F-]{36}"
                            aria-label="Evaluator"
                          />
                          <Button type="submit" size="sm" data-testid="assign-reevaluation">
                            Assign
                          </Button>
                        </form>
                      ) : row.status === 'assigned' ? (
                        <form
                          className="flex gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const data = new FormData(event.currentTarget);
                            run(() =>
                              completeReevaluationAction({
                                examinationId: examination.id,
                                requestId: row.id,
                                revisedMarks: Number(data.get('revisedMarks')),
                                notes: String(data.get('notes') ?? '') || undefined,
                              }),
                            );
                          }}
                        >
                          <Input
                            name="revisedMarks"
                            type="number"
                            min={0}
                            required
                            className="w-24"
                            aria-label="Revised marks"
                          />
                          <Button type="submit" size="sm" data-testid="complete-reevaluation">
                            Complete
                          </Button>
                        </form>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
