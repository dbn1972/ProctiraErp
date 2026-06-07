/**
 * Default Notification Templates
 *
 * All templates use {{brand_name}} for the platform display name instead of
 * hardcoded brand strings (e.g., "ProctiraERP"). At render time, the active
 * tenant's Brand_Name configuration value is injected via variable substitution.
 *
 * Requirements:
 * - 36.2: Prohibit hardcoded brand strings in source code
 * - 36.4: Substitute configured Brand_Name from active tenant's configuration
 * - 36.5: Apply Brand_Name to notification email subject lines and signatures
 * - 22.4: Template-based notifications with variable substitution
 */

export interface DefaultTemplate {
  name: string;
  channel: 'email' | 'in_app' | 'push' | 'webhook';
  subject: string | null;
  body: string;
  variables: string[];
}

// ─── Email Templates ─────────────────────────────────────────────────────────

export const welcomeEmailTemplate: DefaultTemplate = {
  name: 'Welcome Email',
  channel: 'email',
  subject: 'Welcome to {{brand_name}}',
  body: `Dear {{recipient_name}},

Welcome to {{brand_name}}! Your account has been successfully created.

You can now log in and start using the platform. If you have any questions, please contact your institution administrator.

Best regards,
The {{brand_name}} Team`,
  variables: ['brand_name', 'recipient_name'],
};

export const passwordResetEmailTemplate: DefaultTemplate = {
  name: 'Password Reset Email',
  channel: 'email',
  subject: '{{brand_name}} - Password Reset Request',
  body: `Dear {{recipient_name}},

We received a request to reset your password for your {{brand_name}} account.

Click the link below to reset your password:
{{reset_link}}

This link will expire in 60 minutes. If you did not request a password reset, please ignore this email.

Best regards,
The {{brand_name}} Team`,
  variables: ['brand_name', 'recipient_name', 'reset_link'],
};

export const enrollmentConfirmationEmailTemplate: DefaultTemplate = {
  name: 'Enrollment Confirmation Email',
  channel: 'email',
  subject: '{{brand_name}} - Enrollment Confirmed',
  body: `Dear {{recipient_name}},

This is to confirm that the student {{student_name}} has been successfully enrolled at {{institution_name}} for the {{academic_period}} academic period.

You can view the enrollment details by logging into {{brand_name}}.

Best regards,
The {{brand_name}} Team`,
  variables: ['brand_name', 'recipient_name', 'student_name', 'institution_name', 'academic_period'],
};

export const absenceAlertEmailTemplate: DefaultTemplate = {
  name: 'Absence Alert Email',
  channel: 'email',
  subject: '{{brand_name}} - Absence Threshold Alert',
  body: `Dear {{recipient_name}},

This is an automated alert from {{brand_name}}.

Student {{student_name}} has exceeded the absence threshold with {{absence_count}} absences in the current evaluation period at {{institution_name}}.

Please review the attendance records and take appropriate action.

Best regards,
The {{brand_name}} Team`,
  variables: ['brand_name', 'recipient_name', 'student_name', 'absence_count', 'institution_name'],
};

export const transferNotificationEmailTemplate: DefaultTemplate = {
  name: 'Transfer Notification Email',
  channel: 'email',
  subject: '{{brand_name}} - Student Transfer Notification',
  body: `Dear {{recipient_name}},

A student transfer has been processed in {{brand_name}}.

Student: {{student_name}}
From: {{source_institution}}
To: {{destination_institution}}
Transfer Date: {{transfer_date}}

Please log into {{brand_name}} to review the transfer details.

Best regards,
The {{brand_name}} Team`,
  variables: ['brand_name', 'recipient_name', 'student_name', 'source_institution', 'destination_institution', 'transfer_date'],
};

// ─── Push Notification Templates ─────────────────────────────────────────────

export const pushWelcomeTemplate: DefaultTemplate = {
  name: 'Welcome Push Notification',
  channel: 'push',
  subject: 'Welcome to {{brand_name}}',
  body: 'Your {{brand_name}} account is ready. Tap to get started.',
  variables: ['brand_name'],
};

export const pushAbsenceAlertTemplate: DefaultTemplate = {
  name: 'Absence Alert Push Notification',
  channel: 'push',
  subject: '{{brand_name}} Alert',
  body: '{{brand_name}}: {{student_name}} has exceeded the absence threshold at {{institution_name}}.',
  variables: ['brand_name', 'student_name', 'institution_name'],
};

export const pushAssessmentResultTemplate: DefaultTemplate = {
  name: 'Assessment Result Push Notification',
  channel: 'push',
  subject: '{{brand_name}} - Results Available',
  body: 'Assessment results for {{subject_name}} are now available on {{brand_name}}.',
  variables: ['brand_name', 'subject_name'],
};

// ─── In-App Notification Templates ──────────────────────────────────────────

export const inAppWelcomeTemplate: DefaultTemplate = {
  name: 'Welcome In-App Notification',
  channel: 'in_app',
  subject: null,
  body: 'Welcome to {{brand_name}}! Your account has been set up successfully.',
  variables: ['brand_name'],
};

export const inAppWorkflowAssignedTemplate: DefaultTemplate = {
  name: 'Workflow Assigned In-App Notification',
  channel: 'in_app',
  subject: null,
  body: 'You have a new {{workflow_type}} item pending your review in {{brand_name}}.',
  variables: ['brand_name', 'workflow_type'],
};

export const inAppCertificationExpiryTemplate: DefaultTemplate = {
  name: 'Certification Expiry In-App Notification',
  channel: 'in_app',
  subject: null,
  body: 'Your {{certification_name}} certification is expiring soon. Please update your records in {{brand_name}}.',
  variables: ['brand_name', 'certification_name'],
};

// ─── All Default Templates ───────────────────────────────────────────────────

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  welcomeEmailTemplate,
  passwordResetEmailTemplate,
  enrollmentConfirmationEmailTemplate,
  absenceAlertEmailTemplate,
  transferNotificationEmailTemplate,
  pushWelcomeTemplate,
  pushAbsenceAlertTemplate,
  pushAssessmentResultTemplate,
  inAppWelcomeTemplate,
  inAppWorkflowAssignedTemplate,
  inAppCertificationExpiryTemplate,
];
