import * as React from 'react';

import { Label } from './Label';
import { cn } from './lib/utils';

type ControlAriaProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
};

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
  const generatedId = React.useId();
  const child = React.isValidElement(children)
    ? (children as React.ReactElement<ControlAriaProps>)
    : null;
  // Prefer an explicit id, then the child's own id, then a generated one so the
  // label and ARIA wiring always work.
  const controlId = id ?? htmlFor ?? child?.props.id ?? generatedId;
  const helpText = description ?? hint;
  const errorId = error ? `${controlId}-error` : undefined;
  // The description is hidden while an error is shown, so only reference it when rendered.
  const descriptionId = helpText && !error ? `${controlId}-description` : undefined;
  const describedBy =
    [child?.props['aria-describedby'], descriptionId, errorId].filter(Boolean).join(' ') ||
    undefined;

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
      {child
        ? React.cloneElement(child, {
            id: controlId,
            'aria-invalid': error ? true : child.props['aria-invalid'],
            // Merge rather than overwrite any aria-describedby the caller already set.
            'aria-describedby': describedBy,
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
