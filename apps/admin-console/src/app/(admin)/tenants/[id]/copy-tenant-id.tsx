'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';

export function CopyTenantId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-4 rounded-md border border-dashed px-3 py-2" data-testid="tenant-id-detail">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Tenant id</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <code className="text-xs text-muted-foreground">{id}</code>
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy tenant id'}
        </Button>
      </div>
    </div>
  );
}
