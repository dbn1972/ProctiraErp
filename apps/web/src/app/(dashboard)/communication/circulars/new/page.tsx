import { requireSession } from '@/lib/auth/server';
import { NewCircularForm } from '../../_components/new-circular-form';

export const dynamic = 'force-dynamic';

export default async function NewCircularPage() {
  const session = await requireSession();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">New circular</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Draft a circular. Send it after review; acknowledgements are tracked per recipient.
        </p>
      </div>
      <NewCircularForm createdBy={session.user.sub} />
    </div>
  );
}
