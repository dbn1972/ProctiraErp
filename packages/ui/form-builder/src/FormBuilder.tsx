'use client';

import React, { useMemo } from 'react';
import { useForm, type RegisterOptions } from 'react-hook-form';

import type { FormBuilderProps, FormFieldSchema, ValidationRule } from './types';

/**
 * Schema mistakes (unknown rule type / validator name) throw in development
 * and test so they are caught early, and log in production so a bad schema
 * never silently drops validation nor crashes a live form.
 */
function reportSchemaError(message: string): void {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.['NODE_ENV'];
  if (env === 'development' || env === 'test') {
    throw new Error(`[FormBuilder] ${message}`);
  }
  console.error(`[FormBuilder] ${message}`);
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
  defaultValues = {},
  loading = false,
  className = '',
  ariaLabel,
  validators = {},
}: FormBuilderProps) {
  const allFields = useMemo(
    () => schema.sections.flatMap((section) => section.fields),
    [schema.sections],
  );

  const computedDefaults = useMemo(() => {
    const defaults: Record<string, unknown> = { ...defaultValues };
    for (const field of allFields) {
      if (defaults[field.name] === undefined && field.defaultValue !== undefined) {
        defaults[field.name] = field.defaultValue;
      }
    }
    return defaults;
  }, [allFields, defaultValues]);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: computedDefaults,
  });

  const watchedValues = watch();

  const buildValidation = (rules?: ValidationRule[]): RegisterOptions => {
    if (!rules || rules.length === 0) return {};

    const options: RegisterOptions = {};
    for (const rule of rules) {
      switch (rule.type) {
        case 'required':
          if (rule.value !== false) options.required = rule.message;
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
        case 'pattern':
          options.pattern = { value: new RegExp(String(rule.value)), message: rule.message };
          break;
        case 'custom': {
          const name = String(rule.value ?? '');
          const validator = validators[name];
          if (!validator) {
            reportSchemaError(`No validator registered for custom rule "${name}"`);
            break;
          }
          const existing =
            typeof options.validate === 'object' && options.validate !== null
              ? options.validate
              : {};
          options.validate = {
            ...existing,
            [`custom:${name}`]: async (value: unknown, values: Record<string, unknown>) => {
              const result = await validator(value, values);
              return result === true ? true : typeof result === 'string' ? result : rule.message;
            },
          };
          break;
        }
        default:
          reportSchemaError(
            `Unknown validation rule type "${String((rule as { type: unknown }).type)}"`,
          );
      }
    }
    return options;
  };

  const isFieldVisible = (field: FormFieldSchema): boolean => {
    if (!field.visibleWhen) return true;
    const { field: depField, value } = field.visibleWhen;
    return watchedValues[depField] === value;
  };

  const renderField = (field: FormFieldSchema) => {
    if (!isFieldVisible(field)) return null;

    const fieldId = `field-${field.name}`;
    const errorId = `${fieldId}-error`;
    const helpId = `${fieldId}-help`;
    const error = errors[field.name];
    const validation = buildValidation(field.validation);

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
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
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
