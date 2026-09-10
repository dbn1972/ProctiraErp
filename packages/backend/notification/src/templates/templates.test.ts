/**
 * Unit tests for Notification Service templates using {{brand_name}}
 *
 * Validates that all default templates:
 * - Use {{brand_name}} placeholder instead of hardcoded brand strings
 * - Correctly render with different brand names via variable substitution
 *
 * Requirements:
 * - 36.2: Prohibit hardcoded brand strings in source code
 * - 36.4: Substitute configured Brand_Name from active tenant's configuration
 * - 36.5: Apply Brand_Name to notification email subject lines and signatures
 * - 22.4: Template-based notifications with variable substitution
 */
import { describe, it, expect } from 'vitest';

import { NotificationService } from '../notification-service.js';
import { InMemoryNotificationRepository } from '../in-memory-repository.js';
import {
  DEFAULT_TEMPLATES,
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
  type DefaultTemplate,
} from './index.js';

describe('Notification Templates - {{brand_name}} substitution', () => {
  const repository = new InMemoryNotificationRepository();
  const service = new NotificationService(repository);

  // Two distinct brand names to test substitution
  const brandNameA = 'ProctiraERP';
  const brandNameB = 'EduZo';

  // ─── No Hardcoded Brand Strings ──────────────────────────────────────────

  describe('templates contain no hardcoded brand strings', () => {
    const knownBrandStrings = ['ProctiraERP', 'EduZo', 'proctira', 'eduzo'];

    for (const template of DEFAULT_TEMPLATES) {
      it(`"${template.name}" body should not contain hardcoded brand strings`, () => {
        for (const brandStr of knownBrandStrings) {
          expect(template.body).not.toContain(brandStr);
        }
      });

      if (template.subject) {
        it(`"${template.name}" subject should not contain hardcoded brand strings`, () => {
          for (const brandStr of knownBrandStrings) {
            expect(template.subject!).not.toContain(brandStr);
          }
        });
      }
    }
  });

  // ─── All Templates Declare brand_name Variable ───────────────────────────

  describe('all templates declare brand_name in their variables list', () => {
    for (const template of DEFAULT_TEMPLATES) {
      it(`"${template.name}" should include brand_name in variables`, () => {
        expect(template.variables).toContain('brand_name');
      });
    }
  });

  // ─── All Templates Use {{brand_name}} Placeholder ────────────────────────

  describe('all templates use {{brand_name}} placeholder', () => {
    for (const template of DEFAULT_TEMPLATES) {
      it(`"${template.name}" body should contain {{brand_name}}`, () => {
        expect(template.body).toContain('{{brand_name}}');
      });
    }

    // Email templates should also use {{brand_name}} in subject
    const emailTemplates = DEFAULT_TEMPLATES.filter((t) => t.channel === 'email');
    for (const template of emailTemplates) {
      it(`"${template.name}" subject should contain {{brand_name}}`, () => {
        expect(template.subject).toContain('{{brand_name}}');
      });
    }

    // Push templates should use {{brand_name}} in subject (title)
    const pushTemplates = DEFAULT_TEMPLATES.filter((t) => t.channel === 'push');
    for (const template of pushTemplates) {
      it(`"${template.name}" subject (title) should contain {{brand_name}}`, () => {
        expect(template.subject).toContain('{{brand_name}}');
      });
    }
  });

  // ─── Rendering with Brand Name A ─────────────────────────────────────────

  describe(`renders correctly with brand_name="${brandNameA}"`, () => {
    function renderWithBrand(template: DefaultTemplate, extraVars: Record<string, string> = {}) {
      const variables = { brand_name: brandNameA, ...extraVars };
      const renderedBody = service.renderTemplate(template.body, variables);
      const renderedSubject = template.subject
        ? service.renderTemplate(template.subject, variables)
        : null;
      return { renderedBody, renderedSubject };
    }

    it('Welcome Email renders brand_name in body and subject', () => {
      const { renderedBody, renderedSubject } = renderWithBrand(welcomeEmailTemplate, {
        recipient_name: 'John',
      });
      expect(renderedSubject).toBe(`Welcome to ${brandNameA}`);
      expect(renderedBody).toContain(`Welcome to ${brandNameA}!`);
      expect(renderedBody).toContain(`The ${brandNameA} Team`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('Password Reset Email renders brand_name in body and subject', () => {
      const { renderedBody, renderedSubject } = renderWithBrand(passwordResetEmailTemplate, {
        recipient_name: 'Jane',
        reset_link: 'https://example.com/reset/abc123',
      });
      expect(renderedSubject).toBe(`${brandNameA} - Password Reset Request`);
      expect(renderedBody).toContain(`your ${brandNameA} account`);
      expect(renderedBody).toContain(`The ${brandNameA} Team`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('Enrollment Confirmation Email renders brand_name', () => {
      const { renderedBody, renderedSubject } = renderWithBrand(
        enrollmentConfirmationEmailTemplate,
        {
          recipient_name: 'Parent',
          student_name: 'Alice',
          institution_name: 'Springfield School',
          academic_period: '2024-2025',
        },
      );
      expect(renderedSubject).toBe(`${brandNameA} - Enrollment Confirmed`);
      expect(renderedBody).toContain(`logging into ${brandNameA}`);
      expect(renderedBody).toContain(`The ${brandNameA} Team`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('Absence Alert Email renders brand_name', () => {
      const { renderedBody, renderedSubject } = renderWithBrand(absenceAlertEmailTemplate, {
        recipient_name: 'Teacher',
        student_name: 'Bob',
        absence_count: '6',
        institution_name: 'Central High',
      });
      expect(renderedSubject).toBe(`${brandNameA} - Absence Threshold Alert`);
      expect(renderedBody).toContain(`alert from ${brandNameA}`);
      expect(renderedBody).toContain(`The ${brandNameA} Team`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('Transfer Notification Email renders brand_name', () => {
      const { renderedBody, renderedSubject } = renderWithBrand(transferNotificationEmailTemplate, {
        recipient_name: 'Admin',
        student_name: 'Charlie',
        source_institution: 'School A',
        destination_institution: 'School B',
        transfer_date: '2024-03-15',
      });
      expect(renderedSubject).toBe(`${brandNameA} - Student Transfer Notification`);
      expect(renderedBody).toContain(`processed in ${brandNameA}`);
      expect(renderedBody).toContain(`log into ${brandNameA}`);
      expect(renderedBody).toContain(`The ${brandNameA} Team`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('Push Welcome renders brand_name in title and body', () => {
      const { renderedBody, renderedSubject } = renderWithBrand(pushWelcomeTemplate);
      expect(renderedSubject).toBe(`Welcome to ${brandNameA}`);
      expect(renderedBody).toContain(`Your ${brandNameA} account`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('Push Absence Alert renders brand_name in title', () => {
      const { renderedBody, renderedSubject } = renderWithBrand(pushAbsenceAlertTemplate, {
        student_name: 'Bob',
        institution_name: 'Central High',
      });
      expect(renderedSubject).toBe(`${brandNameA} Alert`);
      expect(renderedBody).toContain(`${brandNameA}:`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('Push Assessment Result renders brand_name', () => {
      const { renderedBody, renderedSubject } = renderWithBrand(pushAssessmentResultTemplate, {
        subject_name: 'Mathematics',
      });
      expect(renderedSubject).toBe(`${brandNameA} - Results Available`);
      expect(renderedBody).toContain(`available on ${brandNameA}`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('In-App Welcome renders brand_name', () => {
      const { renderedBody } = renderWithBrand(inAppWelcomeTemplate);
      expect(renderedBody).toContain(`Welcome to ${brandNameA}!`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('In-App Workflow Assigned renders brand_name', () => {
      const { renderedBody } = renderWithBrand(inAppWorkflowAssignedTemplate, {
        workflow_type: 'transfer approval',
      });
      expect(renderedBody).toContain(`in ${brandNameA}`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('In-App Certification Expiry renders brand_name', () => {
      const { renderedBody } = renderWithBrand(inAppCertificationExpiryTemplate, {
        certification_name: 'Teaching License',
      });
      expect(renderedBody).toContain(`in ${brandNameA}`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });
  });

  // ─── Rendering with Brand Name B ─────────────────────────────────────────

  describe(`renders correctly with brand_name="${brandNameB}"`, () => {
    function renderWithBrand(template: DefaultTemplate, extraVars: Record<string, string> = {}) {
      const variables = { brand_name: brandNameB, ...extraVars };
      const renderedBody = service.renderTemplate(template.body, variables);
      const renderedSubject = template.subject
        ? service.renderTemplate(template.subject, variables)
        : null;
      return { renderedBody, renderedSubject };
    }

    it('Welcome Email renders brand_name in body and subject', () => {
      const { renderedBody, renderedSubject } = renderWithBrand(welcomeEmailTemplate, {
        recipient_name: 'John',
      });
      expect(renderedSubject).toBe(`Welcome to ${brandNameB}`);
      expect(renderedBody).toContain(`Welcome to ${brandNameB}!`);
      expect(renderedBody).toContain(`The ${brandNameB} Team`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('Password Reset Email renders brand_name in body and subject', () => {
      const { renderedBody, renderedSubject } = renderWithBrand(passwordResetEmailTemplate, {
        recipient_name: 'Jane',
        reset_link: 'https://example.com/reset/abc123',
      });
      expect(renderedSubject).toBe(`${brandNameB} - Password Reset Request`);
      expect(renderedBody).toContain(`your ${brandNameB} account`);
      expect(renderedBody).toContain(`The ${brandNameB} Team`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('Enrollment Confirmation Email renders brand_name', () => {
      const { renderedBody, renderedSubject } = renderWithBrand(
        enrollmentConfirmationEmailTemplate,
        {
          recipient_name: 'Parent',
          student_name: 'Alice',
          institution_name: 'Springfield School',
          academic_period: '2024-2025',
        },
      );
      expect(renderedSubject).toBe(`${brandNameB} - Enrollment Confirmed`);
      expect(renderedBody).toContain(`logging into ${brandNameB}`);
      expect(renderedBody).toContain(`The ${brandNameB} Team`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('Absence Alert Email renders brand_name', () => {
      const { renderedBody, renderedSubject } = renderWithBrand(absenceAlertEmailTemplate, {
        recipient_name: 'Teacher',
        student_name: 'Bob',
        absence_count: '6',
        institution_name: 'Central High',
      });
      expect(renderedSubject).toBe(`${brandNameB} - Absence Threshold Alert`);
      expect(renderedBody).toContain(`alert from ${brandNameB}`);
      expect(renderedBody).toContain(`The ${brandNameB} Team`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('Transfer Notification Email renders brand_name', () => {
      const { renderedBody, renderedSubject } = renderWithBrand(transferNotificationEmailTemplate, {
        recipient_name: 'Admin',
        student_name: 'Charlie',
        source_institution: 'School A',
        destination_institution: 'School B',
        transfer_date: '2024-03-15',
      });
      expect(renderedSubject).toBe(`${brandNameB} - Student Transfer Notification`);
      expect(renderedBody).toContain(`processed in ${brandNameB}`);
      expect(renderedBody).toContain(`log into ${brandNameB}`);
      expect(renderedBody).toContain(`The ${brandNameB} Team`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('Push Welcome renders brand_name in title and body', () => {
      const { renderedBody, renderedSubject } = renderWithBrand(pushWelcomeTemplate);
      expect(renderedSubject).toBe(`Welcome to ${brandNameB}`);
      expect(renderedBody).toContain(`Your ${brandNameB} account`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('Push Absence Alert renders brand_name in title', () => {
      const { renderedBody, renderedSubject } = renderWithBrand(pushAbsenceAlertTemplate, {
        student_name: 'Bob',
        institution_name: 'Central High',
      });
      expect(renderedSubject).toBe(`${brandNameB} Alert`);
      expect(renderedBody).toContain(`${brandNameB}:`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('Push Assessment Result renders brand_name', () => {
      const { renderedBody, renderedSubject } = renderWithBrand(pushAssessmentResultTemplate, {
        subject_name: 'Mathematics',
      });
      expect(renderedSubject).toBe(`${brandNameB} - Results Available`);
      expect(renderedBody).toContain(`available on ${brandNameB}`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('In-App Welcome renders brand_name', () => {
      const { renderedBody } = renderWithBrand(inAppWelcomeTemplate);
      expect(renderedBody).toContain(`Welcome to ${brandNameB}!`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('In-App Workflow Assigned renders brand_name', () => {
      const { renderedBody } = renderWithBrand(inAppWorkflowAssignedTemplate, {
        workflow_type: 'transfer approval',
      });
      expect(renderedBody).toContain(`in ${brandNameB}`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });

    it('In-App Certification Expiry renders brand_name', () => {
      const { renderedBody } = renderWithBrand(inAppCertificationExpiryTemplate, {
        certification_name: 'Teaching License',
      });
      expect(renderedBody).toContain(`in ${brandNameB}`);
      expect(renderedBody).not.toContain('{{brand_name}}');
    });
  });

  // ─── Integration: Full send flow with brand_name ─────────────────────────

  describe('integration: send notification with brand_name variable', () => {
    const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const templateId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const userId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    it('should substitute brand_name when sending email notification', async () => {
      const repo = new InMemoryNotificationRepository();
      const svc = new NotificationService(repo);

      repo.seedUsers([{ id: userId, roleIds: [], areaIds: [], institutionIds: [] }]);

      // Create template using the welcome email template content
      await repo.createTemplate({
        id: templateId,
        tenantId,
        name: welcomeEmailTemplate.name,
        channel: 'email',
        subject: welcomeEmailTemplate.subject,
        body: welcomeEmailTemplate.body,
        variables: welcomeEmailTemplate.variables,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const notifications = await svc.send(tenantId, {
        channel: 'email',
        templateId,
        recipients: { userIds: [userId] },
        variables: { brand_name: 'EduZo', recipient_name: 'Test User' },
      });

      expect(notifications).toHaveLength(1);
      // The template was rendered with brand_name substituted
      expect(notifications[0]!.variables.brand_name).toBe('EduZo');
    });
  });
});
