import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { canAccessHealthRecords } from '@/lib/api/health';
import { CreateNurseIncidentForm } from '../../_components/create-nurse-incident-form';

export const dynamic = 'force-dynamic';

export default async function NewIncidentPage() {
  const session = await requireSession('/health/incidents/new');
  if (!canAccessHealthRecords(session.user.roles ?? [])) {
    return <p className="p-6 text-sm">You need a health role.</p>;
  }
  return (
    <div className="space-y-4 p-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/health/incidents">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Incidents
        </Link>
      </Button>
      <h1 className="text-2xl font-semibold">Log nurse visit</h1>
      <CreateNurseIncidentForm />
    </div>
  );
}
