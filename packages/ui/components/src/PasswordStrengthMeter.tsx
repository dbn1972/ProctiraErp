'use client';

import * as React from 'react';
import { CheckCircle2 } from 'lucide-react';

import { cn } from './lib/utils';

/**
 * `<PasswordStrengthMeter>` — shared sign-up / reset-password strength meter.
 *
 * Surfaces a visual bar plus an optional checklist of satisfied rules so a
 * user knows in real time how their candidate password compares to the
 * tenant policy. The component is purely presentational: callers pass in a
 * pre-computed `grade` (rating + percent + satisfied count) so the same
 * scoring algorithm can drive both this meter and any server-side
 * acceptance check.
 *
 * The four-tier rating contract (`weak | fair | good | strong`) mirrors
 * the shared `scorePassword()` helper documented in design.md §D and is
 * the contract `<SignUp>` (Task 49.2) and `<ResetPassword>` use.
 *
 * Why "shared"?
 *   • Today only `<SignUp>` renders the meter, but `<ResetPassword>` and
 *     `<AdminInviteAccept>` (Task 49.6) need the same widget. Putting the
 *     primitive in `@proctira/ui/components` keeps the visual treatment
 *     consistent and the rule labels in sync (callers supply translated
 *     strings so the component itself stays locale-agnostic).
 */

/** The four ratings emitted by the shared `scorePassword()` contract. */
export type PasswordRating = 'weak' | 'fair' | 'good' | 'strong';

/** Pre-computed grade the meter renders. */
export interface PasswordGrade {
  /** Overall rating bucket. */
  rating: PasswordRating;
  /** Number of satisfied rules out of `rules.length`. */
  satisfied: number;
  /** Width percentage for the meter bar (0..100). */
  percent: number;
}

/** A single rule rendered in the optional checklist. */
export interface PasswordStrengthRule {
  /** Stable key for React reconciliation; typically the rule id. */
  key: string;
  /** Already-translated user-facing rule label. */
  label: string;
  /** Whether the candidate password currently satisfies this rule. */
  satisfied: boolean;
}

export interface PasswordStrengthMeterProps {
  /** The current grade. Pass `null` to hide the meter entirely. */
  grade: PasswordGrade | null;
  /**
   * Optional rule checklist rendered below the bar. When omitted the meter
   * shows just the bar + rating label, which is the right behaviour for
   * very compact layouts (e.g. inline within an admin form).
   */
  rules?: readonly PasswordStrengthRule[];
  /**
   * Already-translated rating label (`Weak`, `Fair`, `Good`, `Strong`).
   * Required so the component stays locale-agnostic.
   */
  ratingLabel: string;
  /**
   * Optional id used by the parent input's `aria-describedby`. The component
   * forwards this onto its outer wrapper so screen readers can associate
   * the rules with the password field.
   */
  id?: string;
  /** Extra class names applied to the outer wrapper. */
  className?: string;
  /** `data-testid` for the outer wrapper. Defaults to `password-meter`. */
  ['data-testid']?: string;
}

/**
 * Maps a rating to the Tailwind utilities used for the bar fill and the
 * rating label colour. Centralising the mapping keeps the visual contract
 * predictable across screens.
 */
function ratingTone(rating: PasswordRating): { bar: string; label: string } {
  switch (rating) {
    case 'strong':
      return { bar: 'bg-emerald-500', label: 'text-emerald-600' };
    case 'good':
      return { bar: 'bg-emerald-400', label: 'text-emerald-600' };
    case 'fair':
      return { bar: 'bg-amber-500', label: 'text-amber-600' };
    default:
      return { bar: 'bg-destructive', label: 'text-destructive' };
  }
}

export const PasswordStrengthMeter = React.forwardRef<HTMLDivElement, PasswordStrengthMeterProps>(
  function PasswordStrengthMeter(
    { grade, rules, ratingLabel, id, className, 'data-testid': testId = 'password-meter', ...rest },
    ref,
  ) {
    if (!grade) return null;

    const tone = ratingTone(grade.rating);

    return (
      <div
        ref={ref}
        id={id}
        role="status"
        aria-live="polite"
        className={cn('space-y-2', className)}
        data-testid={testId}
        {...rest}
      >
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full transition-[width] duration-200', tone.bar)}
              style={{ width: `${Math.max(0, Math.min(100, grade.percent))}%` }}
              data-testid={`${testId}-bar`}
              data-rating={grade.rating}
            />
          </div>
          <span className={cn('text-xs font-medium', tone.label)} data-testid={`${testId}-label`}>
            {ratingLabel}
          </span>
        </div>
        {rules && rules.length > 0 && (
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {rules.map((rule) => (
              <li
                key={rule.key}
                className="flex items-center gap-2 text-xs"
                data-testid={`${testId}-rule-${rule.key}`}
                data-satisfied={rule.satisfied ? 'true' : 'false'}
              >
                <CheckCircle2
                  aria-hidden="true"
                  className={cn(
                    'h-4 w-4',
                    rule.satisfied ? 'text-emerald-600' : 'text-muted-foreground/50',
                  )}
                />
                <span className={rule.satisfied ? 'text-foreground' : 'text-muted-foreground'}>
                  {rule.label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
);
