export type FieldType =
  | 'text'
  | 'email'
  | 'password'
  | 'number'
  | 'tel'
  | 'url'
  | 'textarea'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'radio'
  | 'date'
  | 'datetime'
  | 'file'
  | 'hidden';

export interface FieldOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface ValidationRule {
  type: 'required' | 'minLength' | 'maxLength' | 'min' | 'max' | 'pattern' | 'custom';
  value?: string | number | boolean;
  message: string;
}

export interface FormFieldSchema {
  /** Unique field identifier */
  name: string;
  /** Display label */
  label: string;
  /** Field type */
  type: FieldType;
  /** Placeholder text */
  placeholder?: string;
  /** Default value */
  defaultValue?: unknown;
  /** Help text displayed below the field */
  helpText?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Whether the field is read-only */
  readOnly?: boolean;
  /** Options for select, multiselect, radio, checkbox group */
  options?: FieldOption[];
  /** Validation rules */
  validation?: ValidationRule[];
  /** Conditional visibility: field name to check */
  visibleWhen?: {
    field: string;
    /** Value to compare; an array when `operator` is `'in'`. */
    value: unknown;
    /**
     * Comparison (default `'eq'`). Values are compared loosely by string form,
     * so `1` matches `'1'` and `true` matches `'true'`.
     */
    operator?: 'eq' | 'neq' | 'in';
  };
  /** CSS class for layout */
  className?: string;
  /** Column span in grid layout (1-12) */
  colSpan?: number;
}

export interface FormSection {
  /** Section title */
  title: string;
  /** Section description */
  description?: string;
  /** Fields in this section */
  fields: FormFieldSchema[];
}

export interface FormSchema {
  /** Form title */
  title?: string;
  /** Form description */
  description?: string;
  /** Sections containing fields */
  sections: FormSection[];
  /** Submit button label */
  submitLabel?: string;
  /** Cancel button label */
  cancelLabel?: string;
}

/** Built-in UI strings. Schema `submitLabel`/`cancelLabel` still take precedence. */
export interface FormBuilderLabels {
  selectPlaceholder?: string;
  submit?: string;
  submitting?: string;
  cancel?: string;
  errorSummaryTitle?: string;
  /** Shown when onSubmit rejects without an Error message. */
  submitError?: string;
}

export interface FormBuilderProps {
  /** JSON schema defining the form structure */
  schema: FormSchema;
  /** Callback when form is submitted with valid data */
  onSubmit: (data: Record<string, unknown>) => void | Promise<void>;
  /** Callback when form is cancelled */
  onCancel?: () => void;
  /** Initial values to populate the form */
  defaultValues?: Record<string, unknown>;
  /** Whether the form is in a loading/submitting state */
  loading?: boolean;
  /** Additional CSS class name */
  className?: string;
  /** Accessible label for the form */
  ariaLabel?: string;
  /**
   * Called when `onSubmit` rejects. The form also shows the error message in a
   * role="alert" region and re-enables submit.
   */
  onSubmitError?: (error: unknown) => void;
  /** Localised overrides for built-in strings. */
  labels?: FormBuilderLabels;
}
