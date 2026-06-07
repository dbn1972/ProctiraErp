/**
 * Pending approvals — workflow steps awaiting the current user's action.
 *
 * Validates: Requirement 13.1 — surface approval queue per user.
 */
import { Check, X } from 'lucide-react';

import {
  Button,
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
import { requireSession } from '@/lib/auth/server';
import { listPendingApprovals } from '@/lib/api/workflows';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const session = await requireSession('/workflows/approvals');
  const approvals = await listPendingApprovals();

  return (
    <section aria-labelledby="approvals-heading" className="space-y-6">
      <header>
        <h1 id="approvals-heading" className="text-2xl font-semibold tracking-tight">
          My approvals
        </h1>
        <p className="text-sm text-muted-foreground">
          Workflow steps assigned to {session.user.email} for review.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pending approvals</CardTitle>
          <CardDescription>
            {approvals.length.toLocaleString()} items awaiting action.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {approvals.length === 0 ? (
            <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              You&apos;re all caught up. No approvals pending.
            </p>
          ) : (
            <Table aria-label="Pending approvals">
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead>Requested by</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {approvals.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.definitionName}</TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">{a.subjectType}/</span>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {a.subjectId}
                      </code>
                    </TableCell>
                    <TableCell>{a.stepName}</TableCell>
                    <TableCell>{a.requestedBy}</TableCell>
                    <TableCell>{a.requestedAt}</TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-2">
                        <Button size="sm">
                          <Check className="me-1 h-4 w-4" aria-hidden="true" />
                          Approve
                        </Button>
                        <Button size="sm" variant="destructive">
                          <X className="me-1 h-4 w-4" aria-hidden="true" />
                          Reject
                        </Button>
                      </div>
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
