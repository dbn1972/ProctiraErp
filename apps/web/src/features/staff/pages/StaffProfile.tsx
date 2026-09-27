/**
 * StaffProfile — single-staff profile and timeline.
 *
 * Migrated from `School Platform Design/src/app/components/StaffProfile.tsx`
 * per task 60.2. Loads display name from the gateway (never raw id as title).
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { browserGatewayFetch } from '@/lib/api/browser-gateway';
import { formatPersonLabel } from '@/lib/entity-label';

interface StaffSummary {
  id: string;
  firstName: string;
  lastName: string;
  position?: string;
}

export default function StaffProfile() {
  const { id } = useParams<{ id: string }>();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    browserGatewayFetch<StaffSummary>(`/staff/${id}`)
      .then((staff) => {
        if (cancelled) return;
        setDisplayName(formatPersonLabel(staff.firstName, staff.lastName, staff.position));
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setDisplayName(null);
        setError(err instanceof Error ? err.message : 'Failed to load staff profile');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const heading = displayName ?? 'Staff profile';

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p className="mt-2 text-muted-foreground">
        Personal info, qualifications, and assignments for this staff member.
      </p>
      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
