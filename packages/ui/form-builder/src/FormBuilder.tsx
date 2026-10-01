'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { get, useForm, type RegisterOptions } from 'react-hook-form';

import { compileSchemaPattern } from './pattern-safety';
import type { FormBuilderProps, FormFieldSchema, ValidationRule } from './types';

const looselyEqual = (a: unknown, b: unknown): boolean =>
  a === b ||
  (a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b));

/** Evaluate a field's `visibleWhen` against current form values. */
function isVisibleIn(field: FormFieldSchema, values: Record<string, unknown>): boolean {
  if (!field.visibleWhen) return true;
  const { field: depField, value, operator = 'eq' } = field.visibleWhen;
  const actual: unknown = get(values, depField);
  switch (operator) {
    case 'neq':
      return !looselyEqual(actual, value);
    case 'in':
      return Array.isArray(value) && value.some((v) => looselyEqual(actual, v));
    default:
      return looselyEqual(actual, value);
  }
}

/** Remove a (possibly dotted) key from a nested object in place. */
function unsetPath(target: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  let node: unknown = target;
  for (const part of parts.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return;
    node = (node as Record<string, unknown>)[part];
  }
  if (node !== null && typeof node === 'object') {
    delete (node as Record<string, unknown>)[parts[parts.length - 1] as string];
  }
}

/** Module constant so the default prop keeps a stable identity across renders. */
const EMPTY_DEFAULTS: Record<string, unknown> = Object.freeze({}) as Record<string, unknown>;

/** Content key for defaultValues so inline object literals do not trigger resets. */
function defaultsKeyOf(values: Record<string, unknown>): string {
  try {
    return JSON.stringify(values);
  } catch {
    return String(Math.random());
  }
}

/** Deep-copy plain form data (falls back to a shallow copy for non-cloneable values). */
function structuredCloneSafe(data: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(data);
  } catch {
    return { ...data };
  }
}

/**
 * FormBuilder component for dynamic form rendering from JSON schema.
 * Built on React Hook Form. Meets WCAG 2.1 Level AA accessibility standards.
 *
 * @example
 * ```tsx
 * <FormBuilder
 *   schema={{
 *     sections: [{
 *       title: 'Personal Info',
 *       fields: [{ name: 'firstName', label: 'First Name', type: 'text', validation: [{ type: 'required', message: 'Required' }] }]
 *     }]
 *   }}
 *   onSubmit={(data) => console.log(data)}
 * />
 * ```
 */
export function FormBuilder({
  schema,
  onSubmit,
  onCancel,
  defaultValues = EMPTY_DEFAULTS,
  loading = false,
  className = '',
  ariaLabel,
  onSubmitError,
}: FormBuilderProps) {
  const allFields = useMemo(
    () => schema.sections.flatMap((section) => section.fields),
    [schema.sections],
  );

  const defaultsKey = defaultsKeyOf(defaultValues);
  const computedDefaults = useMemo(() => {
    const defaults: Record<string, unknown> = { ...defaultValues };
    for (const field of allFields) {
      if (defaults[field.name] === undefined && field.defaultValue !== undefined) {
        defaults[field.name] = field.defaultValue;
      }
    }
    return defaults;
    // defaultsKey tracks defaultValues by content, not identity.
  }, [allFields, defaultsKey]);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: computedDefaults,
  });

  // Re-populate the form when defaults change after mount (e.g. async-loaded record).
  const mountedDefaults = useRef(computedDefaults);
  useEffect(() => {
    if (mountedDefaults.current === computedDefaults) return;
    mountedDefaults.current = computedDefaults;
    reset(computedDefaults);
  }, [computedDefaults, reset]);

  const [submitError, setSubmitError] = useState<string | null>(null);

  const watchedValues = watch();

  const buildValidation = (rules?: ValidationRule[]): RegisterOptions => {
    if (!rules || rules.length === 0) return {};

    const options: RegisterOptions = {};
    for (const rule of rules) {
      switch (rule.type) {
        case 'required':
          options.required = rule.message;
          break;
        case 'minLength':
          options.minLength = { value: Number(rule.value), message: rule.message };
          break;
        case 'maxLength':
          options.maxLength = { value: Number(rule.value), message: rule.message };
          break;
        case 'min':
          options.min = { value: Number(rule.value), message: rule.message };
          break;
        case 'max':
          options.max = { value: Number(rule.value), message: rule.message };
          break;
        case 'pattern': {
          // Never compile untrusted patterns unguarded: invalid or catastrophic
          // patterns are skipped (and logged) instead of crashing/hanging render.
          const compiled = compileSchemaPattern(rule.value);
          if (compiled.ok) {
            options.pattern = { value: compiled.regex, message: rule.message };
          } else {
            console.error(`[FormBuilder] Ignoring pattern rule: ${compiled.reason}`);
          }
          break;
        }
      }
    }
    return options;
  };

  // Compile validation once per schema change, not on every render.
  const validationByField = useMemo(
    () => new Map(allFields.map((f) => [f.name, buildValidation(f.validation)])),
    [allFields],
  );

  const isFieldVisible = (field: FormFieldSchema): boolean => isVisibleIn(field, watchedValues);

  /** Hidden (visibleWhen=false) fields must not leak stale values into the payload. */
  const withoutHiddenFields = (data: Record<string, unknown>): Record<string, unknown> => {
    const result = structuredCloneSafe(data);
    for (const field of allFields) {
      if (!isVisibleIn(field, data)) unsetPath(result, field.name);
    }
    return result;
  };

  // RHF also passes the submit event; forward it to keep the existing call shape.
  // A rejected onSubmit is caught and surfaced (role=alert) instead of becoming an
  // unhandled rejection; isSubmitting then clears so the submit button re-enables.
  const submitVisible = async (data: Record<string, unknown>, event?: React.BaseSyntheticEvent) => {
    setSubmitError(null);
    try {
      await (
        onSubmit as (
          d: Record<string, unknown>,
          e?: React.BaseSyntheticEvent,
        ) => void | Promise<void>
      )(withoutHiddenFields(data), event);
    } catch (err) {
      onSubmitError?.(err);
      setSubmitError(
        err instanceof Error && err.message
          ? err.message
          : 'Something went wrong. Please try again.',
      );
    }
  };

  const renderField = (field: FormFieldSchema) => {
    if (!isFieldVisible(field)) return null;

    const fieldId = `field-${field.name}`;
    const errorId = `${fieldId}-error`;
    const helpId = `${fieldId}-help`;
    const error = errors[field.name];
    const validation = validationByField.get(field.name) ?? {};

    const ariaDescribedBy =
      [field.helpText ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') ||
      undefined;

    const commonProps = {
      id: fieldId,
      disabled: field.disabled || loading,
      readOnly: field.readOnly,
      'aria-invalid': !!error,
      'aria-describedby': ariaDescribedBy,
      'aria-required': validation.required ? true : undefined,
      className: `proctira-form__input ${error ? 'proctira-form__input--error' : ''}`,
    };

    let input: React.ReactNode;

    switch (field.type) {
      case 'textarea':
        input = (
          <textarea
            {...commonProps}
            {...register(field.name, validation)}
            placeholder={field.placeholder}
            rows={4}
          />
        );
        break;

      case 'select':
        input = (
          <select {...commonProps} {...register(field.name, validation)}>
            <option value="">{field.placeholder ?? 'Select...'}</option>
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </select>
        );
        break;

      case 'radio':
        input = (
          <fieldset
            className="proctira-form__radio-group"
            role="radiogroup"
            aria-labelledby={`${fieldId}-legend`}
          >
            <legend id={`${fieldId}-legend`} className="proctira-form__legend">
              {field.label}
            </legend>
            {field.options?.map((opt) => (
              <label key={opt.value} className="proctira-form__radio-label">
                <input
                  type="radio"
                  value={opt.value}
                  disabled={opt.disabled || field.disabled || loading}
                  {...register(field.name, validation)}
                  className="proctira-form__radio-input"
                />
                {opt.label}
              </label>
            ))}
          </fieldset>
        );
        break;

      case 'checkbox':
        input = (
          <label className="proctira-form__checkbox-label" htmlFor={fieldId}>
            <input
              type="checkbox"
              {...commonProps}
              {...register(field.name, validation)}
              className="proctira-form__checkbox-input"
            />
            {field.label}
          </label>
        );
        break;

      default:
        input = (
          <input
            type={field.type}
            {...commonProps}
            {...register(field.name, validation)}
            placeholder={field.placeholder}
          />
        );
        break;
    }

    return (
      <div
        key={field.name}
        className={`proctira-form__field ${field.className ?? ''}`}
        style={field.colSpan ? { gridColumn: `span ${field.colSpan}` } : undefined}
      >
        {field.type !== 'checkbox' && field.type !== 'radio' && (
          <label htmlFor={fieldId} className="proctira-form__label">
            {field.label}
            {validation.required && (
              <span className="proctira-form__required" aria-hidden="true">
                {' '}
                *
              </span>
            )}
          </label>
        )}
        {input}
        {field.helpText && (
          <p id={helpId} className="proctira-form__help">
            {field.helpText}
          </p>
        )}
        {error && (
          <p id={errorId} className="proctira-form__error" role="alert" aria-live="polite">
            {error.message as string}
          </p>
        )}
      </div>
    );
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(submitVisible)(e)}
      className={`proctira-form ${className}`}
      aria-label={ariaLabel ?? schema.title ?? 'Form'}
      noValidate
    >
      {schema.title && <h2 className="proctira-form__title">{schema.title}</h2>}
      {schema.description && <p className="proctira-form__description">{schema.description}</p>}

      {schema.sections.map((section, sectionIndex) => (
        <fieldset key={sectionIndex} className="proctira-form__section">
          <legend className="proctira-form__section-title">{section.title}</legend>
          {section.description && (
            <p className="proctira-form__section-description">{section.description}</p>
          )}
          <div className="proctira-form__fields">{section.fields.map(renderField)}</div>
        </fieldset>
      ))}

      {submitError && (
        <div className="proctira-form__submit-error" role="alert">
          {submitError}
        </div>
      )}

      <div className="proctira-form__actions">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={loading || isSubmitting}
            className="proctira-form__cancel-btn"
          >
            {schema.cancelLabel ?? 'Cancel'}
          </button>
        )}
        <button
          type="submit"
          disabled={loading || isSubmitting}
          className="proctira-form__submit-btn"
          aria-busy={isSubmitting}
        >
          {isSubmitting ? 'Submitting...' : (schema.submitLabel ?? 'Submit')}
        </button>
      </div>
    </form>
  );
}
