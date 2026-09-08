import * as React from 'react';

import { cn } from './lib/utils';
import { Label } from './Label';

export interface FormFieldProps {
  /**
   * Stable id for the inner control. Either `id` or `htmlFor` may be used;
   * the value is forwarded to the inner control via cloneElement.
   */
  id?: string;
  /** Alias of {@link FormFieldProps.id} for direct shadcn-style usage. */
  htmlFor?: string;
  /** Label text. */
  label: React.ReactNode;
  /** Optional helper text shown below the input. Alias `hint`. */
  description?: React.ReactNode;
  /** Backwards-compatible alias for {@link FormFieldProps.description}. */
  hint?: React.ReactNode;
  /** Validation error message. */
  error?: React.ReactNode;
  /** Show a required indicator after the label. */
  required?: boolean;
  /** The input/select/etc. control. */
  children: React.ReactNode;
  className?: string;
}

/**
 * Lightweight form field wrapper that pairs a label, a control, and either a
 * description or an inline error message. Clones its child element to inject
 * `id` and ARIA attributes so the field is accessible by default.
 *
 * Migrated from `apps/web/src/components/ui/form-field.tsx` during task
 * 60.1 so app and package consumers share a single canonical wrapper.
 */
export const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(function FormField(
  { id, htmlFor, label, description, hint, error, required, children, className },
  ref,
) {
  const controlId = id ?? htmlFor;
  const helpText = description ?? hint;
  const errorId = error && controlId ? `${controlId}-error` : undefined;
  const descriptionId = helpText && controlId ? `${controlId}-description` : undefined;

  return (
    <div ref={ref} className={cn('space-y-1.5', className)}>
      {label && (
        <Label htmlFor={controlId}>
          {label}
          {required && (
            <span className="ms-1 text-[hsl(var(--destructive))]" aria-hidden="true">
              *
            </span>
          )}
        </Label>
      )}
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement, {
            id: controlId,
            'aria-invalid': error ? true : undefined,
            'aria-describedby': [descriptionId, errorId].filter(Boolean).join(' ') || undefined,
          })
        : children}
      {helpText && !error && (
        <p id={descriptionId} className="text-xs text-[hsl(var(--muted-foreground))]">
          {helpText}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-[hsl(var(--destructive))]">
          {error}
        </p>
      )}
    </div>
  );
});
