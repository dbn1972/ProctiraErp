import { duplicateVariants } from './duplicate-submit.js';
import type { Variant } from './env.js';
import { feesVariants } from './fees.js';
import { hostelLibraryVariants } from './hostel-library.js';
import { marksVariants } from './marks.js';
import { payrollVariants } from './payroll.js';
import { seatVariants } from './seats.js';
/** Every t05 race variant, in run order. */
export const ALL_VARIANTS: readonly Variant[] = [
  ...duplicateVariants,
  ...feesVariants,
  ...payrollVariants,
  ...seatVariants,
  ...hostelLibraryVariants,
  ...marksVariants,
];
export type { RaceEnv, Variant, VariantRound } from './env.js';
