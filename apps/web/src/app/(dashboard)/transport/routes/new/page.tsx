import { requireSession } from '@/lib/auth/server';
import { NewRouteForm } from '../../_components/new-route-form';

export const dynamic = 'force-dynamic';

export default async function TransportNewRoutePage() {
  await requireSession();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New transport route</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Creates a new transport route for your school.
        </p>
      </div>
      <NewRouteForm />
    </div>
  );
}
