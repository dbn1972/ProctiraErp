# DataVault Form Validation Quality Audit

## Role

Act as a **senior QA engineer, product quality auditor, accessibility reviewer, and enterprise SaaS validation specialist**.

You are evaluating the **form validation quality** of the DataVault application.

The goal is not only to check whether forms technically submit, but to determine whether every form behaves like a **world-class enterprise SaaS product**: clear, safe, accessible, consistent, resilient, and user-friendly.

---

## Product Context

DataVault is an enterprise document vault, compliance, workflow, audit, and administration platform.

Relevant modules include:

- Authentication
- MFA
- Vault Management
- Document Management
- Audit Trail
- Approval Workflows
- Policy Management
- Webhooks
- API Keys
- User Management
- Tenant Management
- Branding
- Enterprise Readiness
- Security Console
- Dashboard

Current product status includes significant implementation progress across frontend pages, backend services, APIs, tests, migrations, and known gaps. Use the repository as the source of truth and validate the actual implementation, not assumptions.

---

# Objective

Perform a complete **Form Validation Quality Audit** for DataVault.

Evaluate every important form for:

- Required field validation
- Format validation
- Boundary validation
- Length validation
- Special character handling
- Duplicate value handling
- Security-sensitive input handling
- File validation
- Error message clarity
- Accessibility
- Mobile usability
- Network failure behavior
- Backend/API validation consistency
- Frontend/backend validation alignment
- Enterprise-grade user experience

---

# Forms to Evaluate

Test at minimum the following forms and flows:

## Authentication Forms

- Login
- MFA challenge
- Forgot password
- Reset password
- Change password
- Session revocation confirmation, if applicable

## Vault Forms

- Create vault
- Edit vault
- Vault classification selection
- Vault archive/delete confirmation

## Document Forms

- Upload document
- Edit document metadata
- Apply legal hold
- Release legal hold
- External share link creation
- Document delete confirmation

## Search and Filter Forms

- Document search
- Audit log filters
- Policy filters
- Workflow filters
- User filters
- Webhook delivery filters

## Policy Forms

- Create policy
- Edit policy
- Policy state transition
- Delete policy confirmation

## Workflow Forms

- Create approval request
- Approve workflow
- Reject workflow
- Approval comment input

## Webhook Forms

- Create webhook
- Edit webhook
- Rotate webhook secret
- Replay webhook delivery
- Retry DLQ item, if available

## API Key Forms

- Create API key
- Revoke API key
- API key scope/permission selection, if available

## User Management Forms

- Invite user
- Update user role
- Update user status
- Notification preferences
- Test notification

## Tenant Management Forms

- Tenant settings
- MFA enforcement setting
- Tenant provisioning
- Tenant update
- Tenant delete/archive confirmation

## Branding Forms

- Branding settings
- Logo upload
- Favicon upload
- Custom CSS input
- Branding import
- Branding reset confirmation
- Branding preview

## Admin / Readiness / Security Forms

- Readiness dashboard actions
- Diagnostics export, if available
- Security console export
- Posture scan action
- SIEM export action

---

# Test Input Categories

For every applicable field, test the following input classes.

## Empty and Missing Values

Test:

- Empty required fields
- Whitespace-only values
- Null-like strings such as `null`, `undefined`, `None`
- Fields omitted from API payloads
- Required dropdown not selected
- Required checkbox not checked
- Empty file upload

Expected:

- Form should not submit
- Clear field-level error should appear
- Error should identify the exact problem
- Focus should move to or near the first invalid field
- No server-side crash should occur

---

## Invalid Email Values

Test:

- `abc`
- `abc@`
- `abc.com`
- `abc@domain`
- `abc@@domain.com`
- `a b@domain.com`
- Very long email address
- Email with uppercase letters
- Email with plus addressing, such as `user+test@example.com`

Expected:

- Invalid emails rejected
- Valid enterprise-style emails accepted
- Error messages should be clear and not technical

---

## Password and MFA Validation

Test:

- Empty password
- Very short password
- Password without uppercase
- Password without lowercase
- Password without number
- Password without symbol
- Very long password
- Password with spaces
- Password copy/paste behavior
- Reset password mismatch
- Expired reset token behavior
- Invalid MFA code
- Short MFA code
- Long MFA code
- Non-numeric MFA code
- Backup code behavior, if available

Expected:

- Password policy should be clear before failure
- MFA errors should not reveal sensitive security details
- Rate limiting or lockout behavior should be considered
- Reset flows should handle expired/invalid token safely

---

## Text Length and Boundary Values

Test:

- 1 character
- Minimum allowed length minus 1
- Minimum allowed length
- Maximum allowed length
- Maximum allowed length plus 1
- Extremely long text, such as 5,000 to 50,000 characters
- Long approval comments
- Long vault names
- Long document metadata
- Long webhook names
- Long policy descriptions
- Long tenant names
- Long branding text

Expected:

- Limits should be enforced consistently
- Error messages should mention limits
- UI should not freeze or break layout
- Backend should reject oversized payloads safely

---

## Special Characters and Unicode

Test:

- Symbols: `!@#$%^&*()_+-=[]{};':",.<>/?`
- Quotes: `' " \``
- HTML: `<script>alert(1)</script>`
- SQL-like input: `' OR '1'='1`
- Markdown: `# Heading **bold**`
- Emojis: `🚀 ✅ 🔐`
- Non-English text: Hindi, Odia, Bengali, Arabic, Chinese
- Right-to-left text
- Newlines
- Tabs
- Leading and trailing spaces

Expected:

- Input should be safely handled
- No XSS execution
- No broken rendering
- No SQL or query injection behavior
- Unicode should be accepted where appropriate
- Stored values should render safely after save

---

## Duplicate and Conflict Validation

Test duplicate values for:

- Vault names
- Policy names
- Webhook endpoint names
- API key names
- User invitations
- Tenant names
- Branding import names, if applicable

Expected:

- Duplicate handling should be predictable
- User should receive a clear conflict message
- Error should not be generic
- Backend conflict response should be handled cleanly

---

## URL Validation

For webhook URLs, branding URLs, callback URLs, and external links, test:

- Empty URL
- `abc`
- `http://`
- `https://`
- `ftp://example.com`
- `javascript:alert(1)`
- `data:text/html,<script>alert(1)</script>`
- `http://localhost`
- `http://127.0.0.1`
- Private IP addresses
- Public HTTPS URL
- Very long URL
- URL with query parameters
- URL with fragments

Expected:

- Invalid URLs rejected
- Dangerous schemes rejected
- SSRF-prone internal URLs reviewed carefully
- HTTPS should be required where security-sensitive
- Error messages should explain the allowed URL format

---

## File Upload Validation

For document upload, logo upload, favicon upload, branding import, and any file-based form, test:

- No file selected
- Unsupported extension
- Incorrect MIME type
- MIME spoofing
- Empty file
- Very small valid file
- Large file
- File larger than configured limit
- Filename with spaces
- Filename with special characters
- Filename with Unicode
- Filename with multiple extensions, such as `invoice.pdf.exe`
- Corrupt file
- Duplicate filename
- Slow upload
- Interrupted upload
- Network failure during upload

Expected:

- Unsupported files rejected
- File type should be validated securely
- Large files should fail gracefully
- Progress/loading state should be visible
- User should not lose filled metadata after upload failure
- Error should explain the issue clearly

---

## Numeric, Date, and Selection Fields

Where applicable, test:

- Negative numbers
- Zero
- Decimal values
- Very large numbers
- Non-numeric input
- Invalid date
- Past date
- Future date
- Start date after end date
- Retention duration too small
- Retention duration too large
- Invalid dropdown option via API tampering
- Multi-select empty state
- Disabled options

Expected:

- Invalid values rejected
- Date logic enforced
- Backend should not trust frontend-only validation
- Error messages should be business-readable

---

## Network and API Failure Behavior

For each critical form, simulate:

- Backend 400 validation error
- Backend 401 unauthorized
- Backend 403 forbidden
- Backend 404 resource missing
- Backend 409 conflict
- Backend 413 payload too large
- Backend 422 validation error
- Backend 429 rate limit
- Backend 500 server error
- Timeout
- Offline mode
- Slow response

Expected:

- User sees clear error
- No blank screen
- No infinite spinner
- Submit button state resets correctly
- Duplicate submissions are prevented
- Data is not silently lost
- User can retry safely

---

# Accessibility Validation

For every form, check:

- Every input has a visible label or accessible name
- Error messages are associated with fields
- Required fields are announced
- Keyboard-only navigation works
- Tab order is logical
- Focus is visible
- Modal forms trap focus correctly
- Escape closes dialogs where appropriate
- Screen readers can identify validation errors
- Buttons have meaningful labels
- Icons are not used as the only label
- Color is not the only indicator of error
- Error contrast meets WCAG expectations

---

# UX Quality Checks

For every form, evaluate:

- Are required fields clearly marked?
- Are validation errors shown before or after submit appropriately?
- Are messages specific and actionable?
- Are errors placed close to the field?
- Does the form preserve user input after failure?
- Is there a success state after submission?
- Are destructive actions confirmed?
- Are loading states clear?
- Are disabled states understandable?
- Are users prevented from double-submitting?
- Does the form work on mobile?
- Does the form work with keyboard only?
- Does the form feel enterprise-grade?

---

# Frontend and Backend Consistency

Inspect both frontend and backend validation.

For each form, identify:

- Frontend validation rules
- Backend DTO/schema validation rules
- API error response format
- Whether frontend and backend rules match
- Whether backend rejects invalid payloads even if frontend validation is bypassed
- Whether frontend displays backend errors properly

Report any mismatch such as:

- Frontend allows value but backend rejects it
- Frontend rejects value but backend accepts it
- Backend returns technical error not suitable for users
- Validation limits differ between UI and API
- Required field missing in one layer

---

# Automation Requirements

Where practical, add or improve automated tests.

Prefer:

- Playwright for form validation E2E tests
- Existing frontend test framework for component-level validation tests
- Existing backend test framework for DTO/API validation tests
- Accessible selectors such as roles, labels, and visible text
- Mocked API failures where full backend setup is not available

Avoid:

- Brittle CSS selectors
- Tests that depend on random data without cleanup
- Excessive sleeps or timeouts
- Hiding real failures with retries
- Modifying product code unless necessary for testability

---

# Suggested Test Files

Use the repository’s existing conventions. If no convention exists, create a structure similar to:

```text
qa/
  QA_FORM_VALIDATION_REPORT.md
  QA_FORM_VALIDATION_MATRIX.md
  QA_FORM_VALIDATION_RUNBOOK.md

tests/
  e2e/
    forms/
      auth-forms.spec.ts
      vault-forms.spec.ts
      document-forms.spec.ts
      policy-forms.spec.ts
      workflow-forms.spec.ts
      webhook-forms.spec.ts
      api-key-forms.spec.ts
      user-forms.spec.ts
      tenant-forms.spec.ts
      branding-forms.spec.ts
```
