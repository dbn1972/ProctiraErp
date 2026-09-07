import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export default async function TransportAssignmentsPage() {
  await requireSession();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assignments</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Driver and student assignments via `/api/v1/transport/*-assignments`.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active assignments</CardTitle>
          <CardDescription>No assignments loaded yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" role="status">
            Empty assignments list.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
