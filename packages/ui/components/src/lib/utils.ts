/**
 * Utility helpers shared by the @proctira/ui-components primitives.
 *
 * `cn` is the standard shadcn/ui class-name combiner: it lets primitives
 * accept a `className` prop that can override or extend their defaults
 * with Tailwind-aware conflict resolution.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Combine class names with Tailwind-aware conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
