/**
 * Utility helpers for the web application.
 * Provides the standard `cn` class-name combiner used by shadcn/ui primitives.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Combine class names with Tailwind-aware conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
