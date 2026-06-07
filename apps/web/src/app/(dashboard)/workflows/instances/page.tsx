/**
 * Workflow instances list (Server Component).
 *
 * Validates: Requirement 13.1 — view all in-flight workflow instances.
 */
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import {
  listWorkflowInstances,
  type WorkflowInstance,
} from '@/lib/api/workflows';

export const dynamic = 'force-dynamic';

export default async function WorkflowInstancesPage() {
  const instances = await listWorkflowInstances();

  return (
    <section aria-labelledby="instances-heading" className="space-y-6">
      <header>
        <h1 id="instances-heading" className="text-2xl font-semibold tracking-tight">
          Workflow instances
        </h1>
        <p className="text-sm text-muted-foreground">
          Track approval requests as they move through workflow steps.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All instances</CardTitle>
          <CardDescription>
            {instances.length.toLocaleString()} workflow runs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {instances.length === 0 ? (
            <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              No workflow instances active.
            </p>
          ) : (
            <Table aria-label="Workflow instances">
              <TableHeader>
                <TableRow>
                  <TableHead>Definition</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Initiated by</TableHead>
                  <TableHead>Initiated</TableHead>
                  <TableHead>Current step</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instances.map((inst) => (
                  <TableRow key={inst.id}>
                    <TableCell className="font-medium">{inst.definitionName}</TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">{inst.subjectType}/</span>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {inst.subjectId}
                      </code>
                    </TableCell>
                    <TableCell>{inst.initiatedBy}</TableCell>
                    <TableCell>{inst.initiatedAt}</TableCell>
                    <TableCell>{inst.currentStep}</TableCell>
                    <TableCell>
                      <InstanceStatus status={inst.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function InstanceStatus({ status }: { status: WorkflowInstance['status'] }) {
  switch (status) {
    case 'APPROVED':
      return <Badge variant="success">Approved</Badge>;
    case 'REJECTED':
      return <Badge variant="destructive">Rejected</Badge>;
    case 'CANCELLED':
      return <Badge variant="secondary">Cancelled</Badge>;
    default:
      return <Badge variant="warning">Pending</Badge>;
  }
}
