import { z } from 'zod';

const uuid = z.string().uuid();

export const createEnquiryFormSchema = z.object({
  institutionId: uuid,
  academicPeriodId: uuid,
  gradeId: uuid,
  quota: z.string().min(1).max(50).optional(),
  source: z.enum(['website', 'walk_in', 'referral', 'campaign', 'other']).optional(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.string().min(1).max(20).optional(),
  guardianName: z.string().min(1).max(200),
  guardianPhone: z.string().min(1).max(50),
  interviewScore: z.coerce.number().min(0).max(100).optional(),
  testScore: z.coerce.number().min(0).max(100).optional(),
});

export const updateEnquiryStageSchema = z.object({
  id: uuid,
  stage: z.enum(['new', 'contacted', 'qualified', 'applied', 'lost', 'waitlisted']),
});

export const followupFormSchema = z.object({
  enquiryId: uuid,
  dueAt: z.string().min(1),
  ownerId: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

export const seatMatrixFormSchema = z.object({
  institutionId: uuid,
  academicPeriodId: uuid,
  gradeId: uuid,
  quota: z.string().min(1).max(50).optional(),
  seats: z.coerce.number().int().min(0).max(100000),
});

export const generateMeritFormSchema = z
  .object({
    institutionId: uuid,
    academicPeriodId: uuid,
    gradeId: uuid,
    interviewWeight: z.coerce.number().min(0).max(1),
    testWeight: z.coerce.number().min(0).max(1),
  })
  .refine((value) => Math.abs(value.interviewWeight + value.testWeight - 1) < 1e-6, {
    message: 'Interview and test weights must sum to 1',
  });

export const placementScoreFormSchema = z.object({
  applicationId: uuid,
  academicPeriodId: uuid,
  gradeId: uuid,
  quota: z.string().min(1).max(50).optional(),
  interviewScore: z.coerce.number().min(0).max(100),
  testScore: z.coerce.number().min(0).max(100),
});

export const createOfferFormSchema = z.object({
  applicationId: uuid,
  classId: uuid,
  feeAmount: z.coerce.number().min(0).optional(),
});

export const acceptOfferFormSchema = z.object({
  offerId: uuid,
  paymentRef: z.string().min(1).max(100),
  offerFeeInvoiceId: z.string().uuid().optional(),
});

/** PRC-L233: bounded interview slot; endsAt must be after startsAt. */
export const createInterviewSlotFormSchema = z
  .object({
    institutionId: uuid,
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    capacity: z.coerce.number().int().min(1).max(1000).default(1),
    location: z.string().trim().max(200).optional(),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    path: ['endsAt'],
    message: 'End time must be after the start time.',
  });
