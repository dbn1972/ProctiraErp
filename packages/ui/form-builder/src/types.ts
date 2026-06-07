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
    value: unknown;
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
}
