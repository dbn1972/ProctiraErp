'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Search } from 'lucide-react';

import { TenantCombobox, type TenantOption } from '@/components/tenant-combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  tenants: TenantOption[];
}

export function AuditFilter(props: AuditFilterProps) {
  const router = useRouter();
  const [q, setQ] = useState(props.q);

  function push(next: { q?: string; resourceType?: string; tenantId?: string }) {
    const params = new URLSearchParams();
    const newQ = next.q ?? q;
    const newType = next.resourceType ?? props.resourceType;
    const newTenantId = next.tenantId ?? props.tenantId;
    if (newQ) params.set('q', newQ);
    if (newType && newType !== 'all') params.set('resourceType', newType);
    if (newTenantId) params.set('tenantId', newTenantId);
    router.push(`/audit${params.toString() ? `?${params.toString()}` : ''}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="relative min-w-[260px] flex-1">
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
        <SelectTrigger className="w-44" aria-label="Resource type">
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
      <div className="w-64 space-y-1.5">
        <Label htmlFor="audit-tenant">Tenant</Label>
        <TenantCombobox
          id="audit-tenant"
          tenants={props.tenants}
          defaultValue={props.tenantId}
          allowAll
          includePlatform
          onValueChange={(tenantId) => push({ tenantId })}
        />
      </div>
    </div>
  );
}
