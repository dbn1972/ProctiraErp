'use client';

import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';

import { refreshHealthAction } from './actions';

export function RefreshHealthButton() {
  return (
    <form action={refreshHealthAction}>
      <RefreshSubmit />
    </form>
  );
}

function RefreshSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? 'Refreshing…' : 'Refresh snapshot'}
    </Button>
  );
}
