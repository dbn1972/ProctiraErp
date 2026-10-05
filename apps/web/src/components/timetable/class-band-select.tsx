'use client';

import { usePathname, useRouter } from 'next/navigation';

/** Class filter beside the week-grid / list toggle. Options are class bands, never ids. */
export function ClassBandSelect(props: {
  value: string;
  options: Array<{ value: string; label: string }>;
  preserve?: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <label className="flex items-center">
      <span className="sr-only">Section</span>
      <select
        aria-label="Section"
        className="h-8 min-h-8 rounded-md border border-border bg-background px-2 text-xs"
        value={props.value}
        onChange={(event) => {
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(props.preserve ?? {})) {
            if (value) params.set(key, value);
          }
          params.set('class', event.target.value);
          router.push(`${pathname}?${params.toString()}`);
        }}
      >
        <option value="all">All sections</option>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
