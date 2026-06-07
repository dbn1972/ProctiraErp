/**
 * Utility helpers for the Platform Admin Console.
 * Provides the standard `cn` class-name combiner used by shadcn/ui primitives.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Combine class names with Tailwind-aware conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format an ISO date string for display in admin tables. */
export function formatDateTime(value: string | Date | undefined | null): string {
  if (!value) return '—';
  try {
    const date = value instanceof Date ? value : new Date(value);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/** Format an ISO date for compact list display (date only). */
export function formatDate(value: string | Date | undefined | null): string {
  if (!value) return '—';
  try {
    const date = value instanceof Date ? value : new Date(value);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
  } catch {
    return '—';
  }
}
