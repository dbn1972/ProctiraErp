import { ParentScholarshipApply } from './_components/parent-scholarship-apply';

import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import { listChildrenResult } from '@/lib/api/parent-portal';
import { requireSession } from '@/lib/auth/server';
import { resolveEntityLabel } from '@/lib/entity-label';
import { loadStudentLabelsForIds } from '@/lib/load-entity-labels';

export const dynamic = 'force-dynamic';

export default async function ParentScholarshipsPage() {
  await requireSession();
  const childrenResult = await listChildrenResult();
  if (!childrenResult.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Scholarships</h1>
        <ListLoadFailure
          kind={childrenResult.kind}
          status={childrenResult.status}
          returnTo="/parent/scholarships"
        />
      </div>
    );
  }
  const labels = await loadStudentLabelsForIds(
    childrenResult.items.map((child) => child.studentId),
  );
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Scholarships</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Apply for your own child and upload the documents the scheme asks for.
        </p>
      </div>
      <ParentScholarshipApply
        childrenLinks={childrenResult.items.map((child) => ({
          studentId: child.studentId,
          label: resolveEntityLabel(child.studentId, labels, 'Child'),
        }))}
      />
    </div>
  );
}
