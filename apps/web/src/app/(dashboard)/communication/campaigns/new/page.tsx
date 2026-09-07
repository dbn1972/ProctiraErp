import { requireSession } from '@/lib/auth/server';
import { NewCampaignForm } from '../../_components/new-campaign-form';

export const dynamic = 'force-dynamic';

export default async function NewCommunicationCampaignPage() {
  const session = await requireSession();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">New campaign</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Creates a draft via `POST /api/v1/communication/campaigns`.
        </p>
      </div>
      <NewCampaignForm createdBy={session.user.sub} />
    </div>
  );
}
