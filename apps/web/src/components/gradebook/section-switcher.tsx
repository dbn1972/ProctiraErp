'use client';

import { useRouter } from 'next/navigation';

import type { SectionSummary } from '@/lib/api/gradebook';
import { formatCodeNameLabel } from '@/lib/entity-label';

export function GradebookSectionSwitcher({
  institutionId,
  sectionId,
  sections,
}: {
  institutionId: string;
  sectionId: string;
  sections: SectionSummary[];
}) {
  const router = useRouter();
  return (
    <div className="min-w-[16rem]">
      <label className="sr-only" htmlFor="gb-section">
        Switch section
      </label>
      <select
        id="gb-section"
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        data-testid="gradebook-section-picker"
        value={sectionId}
        onChange={(event) => {
          const params = new URLSearchParams();
          params.set('sectionId', event.target.value);
          router.push(`/institutions/${institutionId}/gradebook?${params.toString()}`);
        }}
      >
        {sections.map((section) => (
          <option key={section.id} value={section.id}>
            {formatCodeNameLabel(section.code, section.name)}
          </option>
        ))}
      </select>
    </div>
  );
}
