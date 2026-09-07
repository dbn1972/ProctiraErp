import Link from 'next/link';
import { Plus } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listCampaigns } from '@/lib/api/communication';

import { SendCampaignButton } from '../_components/send-campaign-button';

export const dynamic = 'force-dynamic';

export default async function CommunicationCampaignsPage() {
  await requireSession();
  const campaigns = await listCampaigns();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live list from `/api/v1/communication/campaigns`. Sandbox send marks delivery without
            live provider credentials.
          </p>
        </div>
        <Button asChild>
          <Link href="/communication/campaigns/new">
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            New campaign
          </Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Campaigns</CardTitle>
          <CardDescription>
            {campaigns.length === 0
              ? 'No campaigns yet.'
              : `${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No campaigns yet.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {campaigns.map((campaign) => (
                <li
                  key={campaign.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="communication-campaign-row"
                >
                  <p className="text-sm font-medium text-foreground">{campaign.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {campaign.status} · {campaign.channels.join(', ') || 'no channels'}
                  </p>
                  <SendCampaignButton campaignId={campaign.id} status={campaign.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
