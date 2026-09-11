import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { canAccessHealthRecords } from '@/lib/api/health';
import { CreateVaccinationForm } from '../../_components/create-vaccination-form';

export const dynamic = 'force-dynamic';

export default async function NewVaccinationPage() {
  const session = await requireSession('/health/vaccinations/new');
  if (!canAccessHealthRecords(session.user.roles ?? [])) {
    return <p className="p-6 text-sm">You need a health role.</p>;
  }
  return (
    <div className="space-y-4 p-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/health/vaccinations">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Vaccinations
        </Link>
      </Button>
      <h1 className="text-2xl font-semibold">New vaccination</h1>
      <CreateVaccinationForm />
    </div>
  );
}
