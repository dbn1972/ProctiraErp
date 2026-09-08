'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface TenantsFilterProps {
  status: string;
  search: string;
}

/** Filter bar for the tenants list. Pushes query params on change. */
export function TenantsFilter({ status, search }: TenantsFilterProps) {
  const router = useRouter();
  const [q, setQ] = useState(search);

  function pushParams(next: { status?: string; q?: string }) {
    const params = new URLSearchParams();
    const newStatus = next.status ?? status;
    const newQ = next.q ?? q;
    if (newStatus && newStatus !== 'all') params.set('status', newStatus);
    if (newQ) params.set('q', newQ);
    router.push(`/tenants${params.toString() ? `?${params.toString()}` : ''}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[260px]">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search tenants"
          placeholder="Search by name or slug…"
          value={q}
          className="ps-9"
          onChange={(event) => setQ(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') pushParams({ q });
          }}
        />
      </div>
      <Select value={status} onValueChange={(value) => pushParams({ status: value })}>
        <SelectTrigger className="w-44">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="provisioning">Provisioning</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="suspended">Suspended</SelectItem>
          <SelectItem value="decommissioning">Decommissioning</SelectItem>
          <SelectItem value="archived">Archived</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
