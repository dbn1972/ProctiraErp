'use client';

import { useRouter, usePathname } from 'next/navigation';

/** Switches the page's academic period without dropping the other query filters. */
export function AcademicPeriodSelect(props: {
  value: string;
  options: { id: string; label: string }[];
  preserve?: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <label className="flex max-w-sm flex-col gap-1 text-sm">
      <span className="font-medium">Academic period</span>
      <select
        className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
        aria-label="Academic period"
        value={props.value}
        onChange={(event) => {
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(props.preserve ?? {})) {
            if (value) params.set(key, value);
          }
          params.set('academicPeriod', event.target.value);
          router.push(`${pathname}?${params.toString()}`);
        }}
      >
        {props.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
