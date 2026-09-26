'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import type { ParentChildLink } from '@/lib/api/parent-portal';
import { resolveEntityLabel } from '@/lib/entity-label';

export function ChildSwitcher({
  childrenLinks,
  selectedId,
  studentLabels = {},
}: {
  childrenLinks: ParentChildLink[];
  selectedId: string;
  /** Map of studentId → display name when known. */
  studentLabels?: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (childrenLinks.length < 2) return null;

  return (
    <label className="flex min-h-12 flex-col gap-1 text-sm">
      <span className="text-muted-foreground">Child</span>
      <select
        className="min-h-12 rounded-md border border-input bg-background px-3 text-foreground"
        value={selectedId}
        aria-label="Select child"
        onChange={(event) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set('studentId', event.target.value);
          router.push(`${pathname}?${params.toString()}`);
        }}
      >
        {childrenLinks.map((link) => (
          <option key={link.id} value={link.studentId}>
            {resolveEntityLabel(link.studentId, studentLabels, 'Child')}
          </option>
        ))}
      </select>
    </label>
  );
}
