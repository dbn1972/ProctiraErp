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

interface AuditFilterProps {
  q: string;
  resourceType: string;
  tenantId: string;
}

export function AuditFilter(props: AuditFilterProps) {
  const router = useRouter();
  const [q, setQ] = useState(props.q);
  const [tenantId, setTenantId] = useState(props.tenantId);

  function push(next: { q?: string; resourceType?: string; tenantId?: string }) {
    const params = new URLSearchParams();
    const newQ = next.q ?? q;
    const newType = next.resourceType ?? props.resourceType;
    const newTenantId = next.tenantId ?? tenantId;
    if (newQ) params.set('q', newQ);
    if (newType && newType !== 'all') params.set('resourceType', newType);
    if (newTenantId) params.set('tenantId', newTenantId);
    router.push(`/audit${params.toString() ? `?${params.toString()}` : ''}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[260px]">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search audit"
          placeholder="Action, actor, or resource…"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') push({ q });
          }}
          className="ps-9"
        />
      </div>
      <Select
        value={props.resourceType || 'all'}
        onValueChange={(value) => push({ resourceType: value })}
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="Resource" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All resources</SelectItem>
          <SelectItem value="tenant">Tenant</SelectItem>
          <SelectItem value="plugin">Plugin</SelectItem>
          <SelectItem value="theme">Theme</SelectItem>
          <SelectItem value="plan">Plan</SelectItem>
          <SelectItem value="break-glass">Break-glass</SelectItem>
        </SelectContent>
      </Select>
      <Input
        aria-label="Tenant filter"
        placeholder="Tenant id"
        value={tenantId}
        onChange={(event) => setTenantId(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') push({ tenantId });
        }}
        className="w-44"
      />
    </div>
  );
}
