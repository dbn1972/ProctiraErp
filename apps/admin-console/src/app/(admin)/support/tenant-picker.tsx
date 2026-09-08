'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface TenantOption {
  id: string;
  name: string;
  slug: string;
}

interface TenantPickerProps {
  tenants: TenantOption[];
  selectedId?: string;
}

/** Searchable tenant list — selecting a tenant updates the URL. */
export function TenantPicker({ tenants, selectedId }: TenantPickerProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const filtered = tenants.filter((t) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-3">
      <Input
        placeholder="Search tenants…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search tenants"
      />
      <ul className="max-h-80 space-y-1 overflow-y-auto rounded-md border border-border">
        {filtered.length === 0 && (
          <li className="px-3 py-3 text-sm text-muted-foreground">No matches.</li>
        )}
        {filtered.map((tenant) => {
          const isSelected = tenant.id === selectedId;
          return (
            <li key={tenant.id}>
              <button
                type="button"
                onClick={() =>
                  router.push(`/support?tenantId=${tenant.id}`, {
                    scroll: false,
                  })
                }
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  isSelected
                    ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                    : 'hover:bg-secondary',
                )}
              >
                <span className="font-medium">{tenant.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{tenant.slug}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
