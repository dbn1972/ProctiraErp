/**
 * Workflow definition detail page.
 *
 * Validates: Requirement 13.1 — view workflow definition steps.
 */
import { notFound } from 'next/navigation';

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
import { getWorkflowDefinition } from '@/lib/api/workflows';

interface PageProps {
  params: { id: string };
}

export default async function WorkflowDefinitionPage({ params }: PageProps) {
  const definition = await getWorkflowDefinition(params.id);
  if (!definition) notFound();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-xl">{definition.name}</CardTitle>
              <CardDescription>
                {definition.module} · v{definition.version} · updated {definition.updatedAt}
              </CardDescription>
            </div>
            {definition.active ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="secondary">Inactive</Badge>
            )}
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Steps</CardTitle>
          <CardDescription>
            {definition.steps.length} approval step
            {definition.steps.length === 1 ? '' : 's'} in order.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table aria-label="Workflow steps">
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Order</TableHead>
                <TableHead>Step name</TableHead>
                <TableHead>Approver role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {definition.steps.map((step) => (
                <TableRow key={step.id}>
                  <TableCell>{step.order}</TableCell>
                  <TableCell className="font-medium">{step.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{step.approverRole}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
