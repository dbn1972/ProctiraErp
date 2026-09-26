import type { ListFailureKind } from '@/lib/api/list-result';

/** Frame status when the linked-children list itself failed (not an empty family). */
export function childListFrame(kind: ListFailureKind): {
  status: 'forbidden' | 'error';
  errorMessage: string;
} {
  if (kind === 'denied') {
    return {
      status: 'forbidden',
      errorMessage: 'You do not have access to linked children.',
    };
  }
  if (kind === 'unauthenticated') {
    return {
      status: 'error',
      errorMessage: 'Your session has expired. Sign in again to see your children.',
    };
  }
  if (kind === 'missing') {
    return {
      status: 'error',
      errorMessage: 'Child links are not available for this school yet.',
    };
  }
  return {
    status: 'error',
    errorMessage: 'Linked children could not be loaded. Try again later.',
  };
}
