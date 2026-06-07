'use client';

import * as React from 'react';

import { Label } from './Label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './Select';
import { cn } from './lib/utils';

/**
 * `<RolePicker>` — tenant-driven role selector for the public sign-up
 * screen (Task 49.2, Requirement 4 AC 17) and any other surface that lets
 * the user choose from a small catalog of roles offered by the active
 * tenant (e.g. invite-accept).
 *
 * The component is purely presentational: callers pass in the role list
 * (typically loaded from `GET /api/v1/tenant/signup-roles`) and an
 * `onValueChange` callback. The picker itself stays locale-agnostic — role
 * labels are rendered as supplied by the caller, which is responsible for
 * either translating client-side or trusting the server-side translations
 * the tenant service emits.
 *
 * Visually the component is a thin wrapper around the shared `<Select>`
 * primitive so the trigger styling stays consistent with the rest of the
 * form, but it adds:
 *   • A `loading` state that switches the placeholder to the supplied
 *     "loading" copy and disables the trigger.
 *   • A `requiresApproval` decoration so users can see at a glance which
 *     roles will land them in a "pending approval" queue (Req 4.17).
 *   • Standard `aria-invalid` / `aria-describedby` wiring so the parent
 *     form can attach an error message without re-implementing it here.
 */

/** A single role offered to the user. */
export interface RolePickerRole {
  /** Stable code, e.g. `principal`, `teacher`, `parent`, `student`. */
  id: string;
  /** Already-translated user-facing label. */
  label: string;
  /** Optional short description rendered under the option. */
  description?: string;
  /**
   * When true, accounts created with this role are held in a pending state
   * until the tenant administrator approves them.
   */
  requiresApproval?: boolean;
}

export interface RolePickerProps {
  /** DOM id attached to the trigger, used by the parent `<Label>`. */
  id?: string;
  /** Currently selected role id, or empty string when nothing is chosen. */
  value: string;
  /** Called when the user picks a new role. */
  onValueChange: (value: string) => void;
  /** The catalog of roles to render. */
  roles: readonly RolePickerRole[];
  /** True while `roles` is still being fetched. */
  loading?: boolean;
  /** Disable the trigger entirely. Defaults to `false`. */
  disabled?: boolean;
  /** Already-translated placeholder shown before a role is chosen. */
  placeholder: string;
  /** Already-translated placeholder shown while the catalog is loading. */
  loadingPlaceholder?: string;
  /**
   * Already-translated suffix appended to roles whose `requiresApproval`
   * is true (e.g. "(requires approval)"). Omit to skip the decoration.
   */
  approvalSuffix?: string;
  /** Already-translated accessible label for the trigger. */
  ariaLabel?: string;
  /** Forwarded to the trigger so the parent form can flag the error. */
  ariaInvalid?: boolean;
  /** Forwarded onto the trigger as `aria-describedby`. */
  ariaDescribedBy?: string;
  /** `data-testid` for the trigger. Defaults to `role-picker`. */
  ['data-testid']?: string;
  /** Extra class names applied to the trigger. */
  className?: string;
  /**
   * Optional already-translated label rendered above the trigger. When
   * provided, the component creates its own `<Label>` and links it to the
   * trigger via the `id`. Pass `undefined` to use an external `<Label>`.
   */
  label?: string;
}

export const RolePicker = React.forwardRef<HTMLButtonElement, RolePickerProps>(
  function RolePicker(
    {
      id,
      value,
      onValueChange,
      roles,
      loading = false,
      disabled = false,
      placeholder,
      loadingPlaceholder,
      approvalSuffix,
      ariaLabel,
      ariaInvalid,
      ariaDescribedBy,
      'data-testid': testId = 'role-picker',
      className,
      label,
    },
    ref,
  ) {
    const generatedId = React.useId();
    const triggerId = id ?? `${generatedId}-role-trigger`;

    const effectivePlaceholder =
      loading && loadingPlaceholder ? loadingPlaceholder : placeholder;

    return (
      <div className="space-y-1.5">
        {label && <Label htmlFor={triggerId}>{label}</Label>}
        <Select
          value={value}
          onValueChange={onValueChange}
          disabled={disabled || loading}
        >
          <SelectTrigger
            ref={ref}
            id={triggerId}
            className={cn(className)}
            aria-label={ariaLabel}
            aria-invalid={ariaInvalid ? 'true' : undefined}
            aria-describedby={ariaDescribedBy}
            data-testid={testId}
          >
            <SelectValue placeholder={effectivePlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {roles.map((role) => (
              <SelectItem
                key={role.id}
                value={role.id}
                data-testid={`${testId}-option-${role.id}`}
              >
                <span className="flex flex-col">
                  <span className="font-medium">
                    {role.label}
                    {role.requiresApproval && approvalSuffix && (
                      <span className="ms-1 text-xs font-normal text-muted-foreground">
                        {approvalSuffix}
                      </span>
                    )}
                  </span>
                  {role.description && (
                    <span className="text-xs text-muted-foreground">
                      {role.description}
                    </span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  },
);
