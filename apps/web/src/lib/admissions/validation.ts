import { z } from 'zod';

const uuid = z.string().uuid();

/** PRC-M149: blank form inputs mean "not provided", never 0. */
const blankToUndefined = (value: unknown) =>
  value === '' || value === null || (typeof value === 'number' && Number.isNaN(value))
    ? undefined
    : value;

/** Optional 0..100 score; blank -> undefined (excluded from merit), non-finite rejected. */
const optionalScore = z.preprocess(
  blankToUndefined,
  z.coerce.number().finite().min(0).max(100).optional(),
);

const MAX_AGE_YEARS = 30;

/** PRC-M149: real calendar date, not in the future, within a sensible age range. */
export const pastDateOfBirth = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return (
      date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    );
  }, 'Date of birth is not a valid date')
  .refine((value) => Date.parse(`${value}T00:00:00Z`) <= Date.now(), {
    message: 'Date of birth cannot be in the future',
  })
  .refine(
    (value) => {
      const earliest = new Date();
      earliest.setUTCFullYear(earliest.getUTCFullYear() - MAX_AGE_YEARS);
      return Date.parse(`${value}T00:00:00Z`) >= earliest.getTime();
    },
    { message: `Date of birth must be within the last ${MAX_AGE_YEARS} years` },
  );

/** PRC-M149: E.164 (+<country><number>) or a 10-digit Indian mobile number. */
export const guardianPhoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .pipe(
    z
      .string()
      .regex(
        /^(?:\+[1-9]\d{6,14}|[6-9]\d{9})$/,
        'Enter a valid phone number (e.g. +919876543210 or 9876543210)',
      ),
  );

const MAX_FEE_AMOUNT = 100_000_000;

/** PRC-M149: money as a decimal with at most 2 dp and an upper bound; blank -> undefined. */
const optionalFeeAmount = z.preprocess(
  blankToUndefined,
  z.coerce
    .number()
    .finite()
    .min(0)
    .max(MAX_FEE_AMOUNT)
    .refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, {
      message: 'Fee amount can have at most 2 decimal places',
    })
    .optional(),
);

export const createEnquiryFormSchema = z.object({
  institutionId: uuid,
  academicPeriodId: uuid,
  gradeId: uuid,
  quota: z.string().min(1).max(50).optional(),
  source: z.enum(['website', 'walk_in', 'referral', 'campaign', 'other']).optional(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: pastDateOfBirth,
  gender: z.string().min(1).max(20).optional(),
  guardianName: z.string().min(1).max(200),
  guardianPhone: guardianPhoneSchema,
  interviewScore: optionalScore,
  testScore: optionalScore,
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
  feeAmount: optionalFeeAmount,
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
