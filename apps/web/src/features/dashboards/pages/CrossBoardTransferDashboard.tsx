/**
 * CrossBoardTransferDashboard — workflow view for cross-board transfers.
 *
 * Implements Task 52.3 / Requirement 40.5 / Design §G.5. Renders:
 *   - Header with transfer type badge and current step indicator.
 *   - State-machine stepper (horizontal): Initiated → Documents
 *     Uploaded → Equivalency Mapped → Source Approved → Destination
 *     Approved → Completed.
 *   - Source / destination institution cards.
 *   - Configurable approval steps list with status icons + approver
 *     names.
 *   - Equivalency mapping table (source curriculum → destination
 *     curriculum) with `mapped` / `bridge` / `na` badges.
 *   - Document upload checklist via `<TaskChecklist>`.
 *   - Approver action buttons: Approve / Reject / Request More Info.
 *     Buttons are disabled unless `currentApprover` matches the
 *     active approval step's id (server-enforced; client only
 *     reflects the mocked field today).
 *
 * Data flow: the page consumes `useCrossBoardTransferData(transferId)`
 * which today returns a deterministic mock; task 60.3 swaps that hook
 * to call `/api/v1/transfers/:id`. Page rendering does not change.
 */

import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building,
  CheckCheck,
  CheckCircle2,
  Circle,
  Clock,
  School,
} from 'lucide-react';
import { useParams } from 'react-router-dom';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useAnnounce,
} from '@proctira/ui-components';
import { TaskChecklist, type ChecklistTask } from '@proctira/ui-dashboards';

import { useCrossBoardTransferData } from '../api';
import type {
  CrossBoardTransferData,
  EquivalencyMappingRow,
  EquivalencyMappingStatus,
  TransferApprovalStatus,
  TransferApprovalStep,
  TransferInstitutionRef,
  TransferState,
  TransferStateId,
} from '../api';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type StepperItemStatus = 'completed' | 'current' | 'pending';

function statusForState(
  stateId: TransferStateId,
  currentStateId: TransferStateId,
  completedIds: ReadonlyArray<TransferStateId>,
): StepperItemStatus {
  if (completedIds.includes(stateId)) return 'completed';
  if (stateId === currentStateId) return 'current';
  return 'pending';
}

const APPROVAL_STATUS_LABEL: Record<TransferApprovalStatus, string> = {
  completed: 'Completed',
  current: 'In progress',
  pending: 'Pending',
  rejected: 'Rejected',
};

function approvalBadgeVariant(
  status: TransferApprovalStatus,
): 'default' | 'secondary' | 'warning' | 'destructive' {
  switch (status) {
    case 'completed':
      return 'default';
    case 'current':
      return 'warning';
    case 'rejected':
      return 'destructive';
    default:
      return 'secondary';
  }
}

const EQUIVALENCY_LABELS: Record<EquivalencyMappingStatus, string> = {
  mapped: 'Mapped',
  bridge: 'Bridge exam',
  na: 'Not applicable',
};

function equivalencyBadgeVariant(
  status: EquivalencyMappingStatus,
): 'default' | 'secondary' | 'warning' {
  switch (status) {
    case 'mapped':
      return 'default';
    case 'bridge':
      return 'warning';
    default:
      return 'secondary';
  }
}

/* ------------------------------------------------------------------ */
/* Stepper                                                             */
/* ------------------------------------------------------------------ */

interface StateStepperProps {
  states: ReadonlyArray<TransferState>;
  currentStateId: TransferStateId;
  completedStateIds: ReadonlyArray<TransferStateId>;
}

function StateStepper({ states, currentStateId, completedStateIds }: StateStepperProps) {
  return (
    <ol
      className="flex flex-wrap items-start gap-4"
      data-testid="cross-board-transfer-stepper"
      aria-label="Transfer state machine"
    >
      {states.map((state, idx) => {
        const status = statusForState(state.id, currentStateId, completedStateIds);
        const isLast = idx === states.length - 1;
        return (
          <li
            key={state.id}
            className="flex flex-1 min-w-[140px] items-start gap-3"
            data-testid={`cross-board-transfer-step-${state.id}`}
            data-status={status}
            aria-current={status === 'current' ? 'step' : undefined}
          >
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                  status === 'completed'
                    ? 'bg-[hsl(var(--success))] text-[hsl(var(--success-foreground,var(--background)))]'
                    : status === 'current'
                      ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] ring-2 ring-[hsl(var(--ring))]'
                      : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
                }`}
                aria-hidden="true"
              >
                {status === 'completed' ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : status === 'current' ? (
                  <Clock className="h-4 w-4" />
                ) : (
                  <Circle className="h-4 w-4" />
                )}
              </div>
              {!isLast ? (
                <div
                  className={`mt-1 h-px w-px ${
                    status === 'completed' ? 'bg-[hsl(var(--success))]' : 'bg-[hsl(var(--border))]'
                  }`}
                  aria-hidden="true"
                />
              ) : null}
            </div>
            <div className="space-y-0.5 pt-1">
              <p className="text-sm font-medium text-[hsl(var(--foreground))]">{state.label}</p>
              {state.description ? (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">{state.description}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Institution card                                                    */
/* ------------------------------------------------------------------ */

interface InstitutionCardProps {
  title: string;
  testId: string;
  institution: TransferInstitutionRef;
  variant: 'source' | 'destination';
}

function InstitutionCard({ title, testId, institution, variant }: InstitutionCardProps) {
  const Icon = variant === 'source' ? School : Building;
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-3">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-5 w-5 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          {institution.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <Badge variant="secondary">{institution.board}</Badge>
        {institution.address ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{institution.address}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Approval list                                                       */
/* ------------------------------------------------------------------ */

interface ApprovalListProps {
  approvals: ReadonlyArray<TransferApprovalStep>;
}

function ApprovalList({ approvals }: ApprovalListProps) {
  return (
    <Card data-testid="cross-board-transfer-approvals-card">
      <CardHeader>
        <CardTitle>Approval Steps</CardTitle>
        <CardDescription>Configured approval chain for this transfer</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3" data-testid="cross-board-transfer-approvals-list">
          {approvals.map((step) => (
            <li
              key={step.id}
              className="flex items-start justify-between gap-3 rounded-md border p-3"
              data-testid={`cross-board-transfer-approval-${step.id}`}
              data-status={step.status}
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">{step.name}</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {step.approver}
                  {step.updatedAt ? ` • ${step.updatedAt}` : ''}
                </p>
                {step.note ? (
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">{step.note}</p>
                ) : null}
              </div>
              <Badge variant={approvalBadgeVariant(step.status)}>
                {APPROVAL_STATUS_LABEL[step.status]}
              </Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Equivalency mapping table                                           */
/* ------------------------------------------------------------------ */

interface EquivalencyTableProps {
  rows: ReadonlyArray<EquivalencyMappingRow>;
}

function EquivalencyTable({ rows }: EquivalencyTableProps) {
  return (
    <Card data-testid="cross-board-transfer-equivalency-card">
      <CardHeader>
        <CardTitle>Grade Equivalency</CardTitle>
        <CardDescription>Curriculum mapping between source and destination boards</CardDescription>
      </CardHeader>
      <CardContent>
        <Table data-testid="cross-board-transfer-equivalency-table">
          <TableHeader>
            <TableRow>
              <TableHead>Source subject</TableHead>
              <TableHead className="w-12" aria-hidden="true" />
              <TableHead>Destination subject</TableHead>
              <TableHead className="text-end">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} data-testid={`cross-board-transfer-equivalency-row-${row.id}`}>
                <TableCell>{row.sourceSubject}</TableCell>
                <TableCell aria-hidden="true">
                  <ArrowRight
                    className="h-4 w-4 text-[hsl(var(--muted-foreground))]"
                    aria-hidden="true"
                  />
                </TableCell>
                <TableCell className="font-medium">{row.destinationSubject}</TableCell>
                <TableCell className="text-end">
                  <Badge variant={equivalencyBadgeVariant(row.status)}>
                    {row.status === 'bridge' ? (
                      <AlertTriangle className="me-1 h-3 w-3" aria-hidden="true" />
                    ) : row.status === 'mapped' ? (
                      <CheckCheck className="me-1 h-3 w-3" aria-hidden="true" />
                    ) : (
                      <Circle className="me-1 h-3 w-3" aria-hidden="true" />
                    )}
                    {EQUIVALENCY_LABELS[row.status]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Action buttons                                                      */
/* ------------------------------------------------------------------ */

interface ApproverActionsProps {
  /** Whether the current user is the active approver. */
  enabled: boolean;
  activeStepName?: string;
}

function ApproverActions({ enabled, activeStepName }: ApproverActionsProps) {
  const announce = useAnnounce();
  const [decision, setDecision] = useState<string | null>(null);

  const fire = (choice: string) => {
    setDecision(choice);
    announce(`${choice} recorded${activeStepName ? ` for ${activeStepName}` : ''}`);
  };

  return (
    <Card data-testid="cross-board-transfer-actions-card">
      <CardHeader>
        <CardTitle>Approver Actions</CardTitle>
        <CardDescription>
          {enabled
            ? `Available to the approver for "${activeStepName ?? 'the active step'}".`
            : 'Disabled — only the active approver can act on this transfer.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Button
          disabled={!enabled}
          onClick={() => fire('Approval')}
          data-testid="cross-board-transfer-approve-button"
        >
          <CheckCircle2 className="me-2 h-4 w-4" aria-hidden="true" />
          Approve & Forward
        </Button>
        <Button
          variant="outline"
          disabled={!enabled}
          onClick={() => fire('Rejection')}
          data-testid="cross-board-transfer-reject-button"
        >
          Reject
        </Button>
        <Button
          variant="outline"
          disabled={!enabled}
          onClick={() => fire('Request for more info')}
          data-testid="cross-board-transfer-info-button"
        >
          Request More Info
        </Button>
        {decision ? (
          <p
            className="text-xs text-[hsl(var(--muted-foreground))]"
            data-testid="cross-board-transfer-actions-status"
          >
            Last decision: {decision}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function HeaderSkeleton() {
  return (
    <div className="space-y-2" data-testid="cross-board-transfer-skeleton">
      <Skeleton className="h-7 w-72" />
      <Skeleton className="h-4 w-48" />
    </div>
  );
}

export default function CrossBoardTransferDashboard() {
  const params = useParams<{ transferId?: string }>();
  const { data, isLoading } = useCrossBoardTransferData(params.transferId);

  if (isLoading || !data) {
    return (
      <div className="space-y-6 p-6" data-testid="cross-board-transfer-dashboard">
        <HeaderSkeleton />
        <Skeleton className="h-32 w-full rounded-md" />
        <Skeleton className="h-64 w-full rounded-md" />
      </div>
    );
  }

  const transfer: CrossBoardTransferData = data;
  const activeStep = transfer.approvals.find((s) => s.status === 'current');
  const actionsEnabled = Boolean(
    activeStep && transfer.currentApprover && transfer.currentApprover === activeStep.id,
  );
  const currentStepIndex = transfer.states.findIndex((s) => s.id === transfer.currentStateId) + 1;

  const documentTasks: ReadonlyArray<ChecklistTask> = transfer.documents.map((doc) => ({
    id: doc.id,
    title: doc.name,
    completed: doc.uploaded,
  }));

  return (
    <div className="space-y-6 p-6" data-testid="cross-board-transfer-dashboard">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
            Cross-Board Transfer
          </h1>
          <Badge variant="secondary">{transfer.transferType}</Badge>
          <Badge>
            Step {currentStepIndex} of {transfer.states.length}
          </Badge>
        </div>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {transfer.studentName} ({transfer.studentId})
          {transfer.requestedAt ? ` • Requested ${transfer.requestedAt}` : ''}
        </p>
      </header>

      {/* State-machine stepper */}
      <Card data-testid="cross-board-transfer-state-card">
        <CardHeader>
          <CardTitle>Transfer Workflow</CardTitle>
          <CardDescription>Current state in the transfer state machine</CardDescription>
        </CardHeader>
        <CardContent>
          <StateStepper
            states={transfer.states}
            currentStateId={transfer.currentStateId}
            completedStateIds={transfer.completedStateIds}
          />
        </CardContent>
      </Card>

      {/* Source + destination institutions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <InstitutionCard
          title="Source institution"
          testId="cross-board-transfer-source-card"
          institution={transfer.source}
          variant="source"
        />
        <InstitutionCard
          title="Destination institution"
          testId="cross-board-transfer-destination-card"
          institution={transfer.destination}
          variant="destination"
        />
      </div>

      {/* Approvals + Documents */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ApprovalList approvals={transfer.approvals} />
        <TaskChecklist
          title="Documents"
          description="Upload status of required documents"
          tasks={documentTasks}
          data-testid="cross-board-transfer-documents"
        />
      </div>

      {/* Equivalency mapping */}
      <EquivalencyTable rows={transfer.equivalency} />

      {/* Approver actions */}
      <ApproverActions enabled={actionsEnabled} activeStepName={activeStep?.name} />
    </div>
  );
}
