/**
 * PRC-L232 / PRC-L241 — the server actions that still forwarded raw input now
 * reject malformed ids, enums, arrays and numbers before any gateway call,
 * and still reach the gateway for well-formed input.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetch = vi.hoisted(() =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    data: {
      id: 'x',
      data: [],
      summary: { enrolled: 1 },
      failed: [],
      absence: { id: 'x' },
      affected: [],
    },
    error: null,
  })),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));
vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({ user: { sub: 'u1', tenantId: 't1', roles: [] } })),
}));
vi.mock('@/lib/api/gateway', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/gateway')>()),
  gatewayFetch,
}));

import { deleteRoleAction } from '@/app/(dashboard)/admin/actions';
import {
  deleteNotificationRuleAction,
  toggleNotificationRuleAction,
} from '@/app/(dashboard)/admin/notification-rules-actions';
import { deleteGradingSchemeAction } from '@/app/(dashboard)/assessments/actions';
import {
  createLeaveRequestAction,
  decideLeaveAction,
  decideRegularisationAction,
} from '@/app/(dashboard)/attendance/actions';
import {
  createCampaignAction,
  createEmergencyBlastAction,
  previewAudienceAction,
} from '@/app/(dashboard)/communication/actions';
import { createFeePlanAction, createInvoiceAction } from '@/app/(dashboard)/fees-actions';
import { createAllergyAction, createVaccinationAction } from '@/app/(dashboard)/health/actions';
import { hidePostAction, lockDiscussionAction } from '@/app/(dashboard)/lms/depth-actions';
import {
  retryFailedDisbursementsAction,
  updateScholarshipProgramAction,
} from '@/app/(dashboard)/scholarships/actions';
import { decideStaffLeaveAction } from '@/app/(dashboard)/staff-leave-actions';
import { deleteStaffAction } from '@/app/(dashboard)/staff/actions';
import { getInstitutionGradesAction } from '@/app/(dashboard)/students/actions';
import {
  bulkEnrollStudentsAction,
  createMeetingAction,
  enrollStudentAction,
  publishSectionAction,
} from '@/app/(dashboard)/timetable-actions';
import { evaluateAlertsAction } from '@/app/(dashboard)/transport/actions';
import {
  decideConsentAction,
  payInvoiceAction,
  replyToThreadAction,
} from '@/app/(parent)/parent-actions';
import { payInvoiceStaffAction } from '@/lib/fees/actions';
import {
  deactivateInstitutionAction,
  deleteAcademicPeriodAction,
} from '@/lib/institutions/actions';

const ID = '11111111-1111-4111-8111-111111111111';
const BAD = '../../plugins/plg_001/approve';

function isError(result: unknown): boolean {
  if (Array.isArray(result)) return result.length === 0;
  const r = result as { status?: string; ok?: boolean; success?: boolean };
  return r.status === 'error' || r.ok === false || r.success === false;
}

beforeEach(() => gatewayFetch.mockClear());

describe('malformed input never reaches the gateway', () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['deleteRoleAction ../', () => deleteRoleAction(BAD)],
    ['toggleNotificationRuleAction ../', () => toggleNotificationRuleAction(BAD, true)],
    ['deleteNotificationRuleAction ../', () => deleteNotificationRuleAction(BAD)],
    ['deleteGradingSchemeAction ../', () => deleteGradingSchemeAction(BAD)],
    ['decideRegularisationAction bad id', () => decideRegularisationAction(BAD, 'approve')],
    ['decideLeaveAction bad enum', () => decideLeaveAction(ID, 'delete' as unknown as 'approve')],
    [
      'createLeaveRequestAction javascript: attachment',
      () =>
        createLeaveRequestAction({
          studentId: ID,
          institutionId: ID,
          classId: ID,
          academicPeriodId: ID,
          fromDate: '2026-01-02',
          toDate: '2026-01-03',
          attachmentUrl: 'javascript:alert(1)',
        }),
    ],
    [
      'createCampaignAction unknown channel',
      () => createCampaignAction({ name: 'C', channels: ['fax'] }),
    ],
    [
      'previewAudienceAction unknown scope',
      () => previewAudienceAction({ scope: 'everyone-everywhere' }),
    ],
    [
      'createEmergencyBlastAction empty channels',
      () => createEmergencyBlastAction({ reason: 'Fire', channels: [] }),
    ],
    [
      'createFeePlanAction fractional cents',
      () => createFeePlanAction({ name: 'Tuition', amountCents: 10.5 }),
    ],
    ['createInvoiceAction bad student', () => createInvoiceAction({ studentId: BAD })],
    [
      'createAllergyAction bad severity',
      () =>
        createAllergyAction({
          studentId: ID,
          allergyType: 'food',
          description: 'peanut',
          severity: 'apocalyptic' as unknown as 'mild',
        }),
    ],
    [
      'createVaccinationAction NaN dose',
      () =>
        createVaccinationAction({
          studentId: ID,
          vaccineName: 'MMR',
          doseNumber: Number.NaN,
          dateAdministered: '2026-01-01',
        }),
    ],
    ['lockDiscussionAction ../', () => lockDiscussionAction(BAD, true)],
    ['hidePostAction bad post', () => hidePostAction(ID, BAD, true)],
    [
      'updateScholarshipProgramAction ../',
      () => updateScholarshipProgramAction(BAD, { name: 'x' }),
    ],
    ['retryFailedDisbursementsAction ../ in list', () => retryFailedDisbursementsAction([ID, BAD])],
    [
      'retryFailedDisbursementsAction oversize list',
      () => retryFailedDisbursementsAction(Array.from({ length: 501 }, () => ID)),
    ],
    [
      'decideStaffLeaveAction bad enum',
      () => decideStaffLeaveAction(ID, 'deleted' as unknown as 'approved'),
    ],
    ['deleteStaffAction ../', () => deleteStaffAction(BAD)],
    ['getInstitutionGradesAction ../', () => getInstitutionGradesAction(BAD)],
    [
      'createMeetingAction dayOfWeek 99',
      () =>
        createMeetingAction({
          institutionId: ID,
          academicPeriodId: ID,
          sectionId: ID,
          staffId: ID,
          periodId: ID,
          dayOfWeek: 99,
        }),
    ],
    [
      'enrollStudentAction ../ student',
      () => enrollStudentAction({ institutionId: ID, sectionId: ID, studentId: BAD }),
    ],
    [
      'bulkEnrollStudentsAction oversize',
      () =>
        bulkEnrollStudentsAction({
          institutionId: ID,
          sectionId: ID,
          studentIds: Array.from({ length: 501 }, () => ID),
        }),
    ],
    [
      'publishSectionAction ../ section',
      () => publishSectionAction({ institutionId: ID, sectionId: BAD }),
    ],
    ['evaluateAlertsAction ../ route', () => evaluateAlertsAction(BAD)],
    ['replyToThreadAction ../ thread', () => replyToThreadAction(BAD, 'hello')],
    [
      'decideConsentAction bad enum',
      () => decideConsentAction(ID, 'maybe' as unknown as 'approved'),
    ],
    ['payInvoiceAction ../', () => payInvoiceAction(BAD)],
    ['payInvoiceStaffAction ../', () => payInvoiceStaffAction(BAD)],
    ['deactivateInstitutionAction ../', () => deactivateInstitutionAction(BAD, 'merge')],
    ['deleteAcademicPeriodAction ../', () => deleteAcademicPeriodAction(BAD)],
  ];

  it.each(cases)('%s', async (_label, run) => {
    let result: unknown;
    try {
      result = await run();
    } catch (error) {
      // redirect() after success would throw; a validation failure must not get that far.
      throw new Error(`action threw instead of returning an error state: ${String(error)}`);
    }
    expect(isError(result)).toBe(true);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });
});

describe('well-formed input still reaches the gateway', () => {
  it('enrollStudentAction', async () => {
    const result = await enrollStudentAction({
      institutionId: ID,
      sectionId: ID,
      studentId: ID,
    });
    expect(result).toMatchObject({ ok: true });
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });

  it('createCampaignAction drops the client createdBy and keeps the audience', async () => {
    await createCampaignAction({
      name: 'Term start',
      channels: ['email'],
      audienceJson: { scope: 'grade', grade: '7' },
      createdBy: 'spoofed',
    });
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    const [, init] = gatewayFetch.mock.calls[0] as unknown as [string, { json: unknown }];
    expect(init.json).toEqual({
      name: 'Term start',
      channels: ['email'],
      audienceJson: { scope: 'grade', grade: '7' },
    });
  });

  it('createAllergyAction treats blank optional fields as absent', async () => {
    const result = await createAllergyAction({
      studentId: ID,
      allergyType: 'food',
      description: 'peanut',
      severity: 'severe',
      diagnosedDate: '',
    });
    expect(result.status).toBe('success');
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });
});
