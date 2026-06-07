/**
 * Health record detail page — access-controlled.
 *
 * Validates: Requirement 12.1 — view a single student's health record with
 * RBAC.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Heart, ShieldAlert } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { canAccessHealthRecords, getHealthRecord } from '@/lib/api/health';

interface PageProps {
  params: { studentId: string };
}

export default async function HealthRecordPage({ params }: PageProps) {
  const session = await requireSession(`/health/${params.studentId}`);

  if (!canAccessHealthRecords(session.user.roles)) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-start gap-3 space-y-0">
          <div className="rounded-lg bg-destructive/10 p-2 text-destructive">
            <ShieldAlert className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-base">Access denied</CardTitle>
            <CardDescription>
              Your role does not allow access to this health record.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>
    );
  }

  const record = await getHealthRecord(params.studentId);
  if (!record) notFound();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Heart className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="text-xl">{record.studentName}</CardTitle>
              <CardDescription>Last updated {record.lastUpdated}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <SummaryRow label="Blood type" value={record.bloodType ?? '—'} />
          <SummaryRow
            label="Emergency contact"
            value={
              record.emergencyContactName
                ? `${record.emergencyContactName}${record.emergencyContactPhone ? ' · ' + record.emergencyContactPhone : ''}`
                : '—'
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Allergies</CardTitle>
        </CardHeader>
        <CardContent>
          {record.allergies?.length ? (
            <ul className="flex flex-wrap gap-2">
              {record.allergies.map((a) => (
                <Badge key={a} variant="warning">
                  {a}
                </Badge>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None recorded.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Chronic conditions</CardTitle>
        </CardHeader>
        <CardContent>
          {record.chronicConditions?.length ? (
            <ul className="flex flex-wrap gap-2">
              {record.chronicConditions.map((c) => (
                <Badge key={c} variant="secondary">
                  {c}
                </Badge>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None recorded.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button>Edit record</Button>
          <Button asChild variant="outline">
            <Link href="/health">Back to records</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
