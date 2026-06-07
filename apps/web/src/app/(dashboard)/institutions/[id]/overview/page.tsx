/**
 * Overview tab — Server Component.
 *
 * Shows summary information, contact details, address, and geo coordinates
 * for the active institution.
 */
import { AlertTriangle, Mail, MapPin, Phone } from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { getInstitution } from '@/lib/institutions/api';

interface OverviewPageProps {
  params: { id: string };
}

export default async function InstitutionOverviewPage({ params }: OverviewPageProps) {
  const institution = await getInstitution(params.id);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {institution.status === 'INACTIVE' && (
        <div className="lg:col-span-2">
          <div
            role="alert"
            className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">This institution is deactivated.</p>
              {institution.deactivationReason && (
                <p className="mt-1 text-amber-800">
                  Reason: {institution.deactivationReason}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <SummaryRow label="Type" value={institution.typeId} mono />
          <SummaryRow label="Sector" value={institution.sectorId} mono />
          <SummaryRow label="Ownership" value={institution.ownershipId} mono />
          <SummaryRow label="Area" value={institution.areaId} mono />
          <SummaryRow
            label="Created"
            value={new Date(institution.createdAt).toLocaleString()}
          />
          <SummaryRow
            label="Last updated"
            value={new Date(institution.updatedAt).toLocaleString()}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contacts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {institution.contactPhone ? (
            <p className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <a
                href={`tel:${institution.contactPhone}`}
                className="text-primary hover:underline"
              >
                {institution.contactPhone}
              </a>
            </p>
          ) : (
            <p className="text-muted-foreground">No phone on file.</p>
          )}
          {institution.contactEmail ? (
            <p className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <a
                href={`mailto:${institution.contactEmail}`}
                className="text-primary hover:underline"
              >
                {institution.contactEmail}
              </a>
            </p>
          ) : (
            <p className="text-muted-foreground">No email on file.</p>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Address &amp; location</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {institution.address ? (
            <p className="flex items-start gap-2">
              <MapPin
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span>{institution.address}</span>
            </p>
          ) : (
            <p className="text-muted-foreground">No address on file.</p>
          )}
          <div className="grid grid-cols-2 gap-4 text-sm md:max-w-md">
            <SummaryRow
              label="Latitude"
              value={institution.latitude !== null ? institution.latitude : '—'}
            />
            <SummaryRow
              label="Longitude"
              value={institution.longitude !== null ? institution.longitude : '—'}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={
          mono
            ? 'font-mono text-xs text-foreground/90'
            : 'text-foreground/90'
        }
      >
        {value}
      </dd>
    </div>
  );
}
