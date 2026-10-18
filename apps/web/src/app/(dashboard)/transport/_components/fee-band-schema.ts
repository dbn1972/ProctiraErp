/**
 * Transport fee band validation shared by the server action and tests (PRC-L059).
 * Server-side rules mirror the form: max distance must not be below min, and
 * the amount is capped so a typo cannot create an absurd band.
 */
import { z } from 'zod';

import { isIso4217Code } from '@proctira/common';

/** Upper bound per band: 10,00,000.00 in major units (stored as cents/paise). */
export const MAX_TRANSPORT_FEE_CENTS = 100_000_000;

export const feeBandSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    routeId: z.string().uuid().optional(),
    stopId: z.string().uuid().optional(),
    minDistanceKm: z.number().finite().min(0).optional(),
    maxDistanceKm: z.number().finite().min(0).optional(),
    amountCents: z
      .number()
      .int()
      .min(0)
      .max(MAX_TRANSPORT_FEE_CENTS, 'Amount exceeds the maximum allowed for a transport fee band.'),
    // PRC-L059 / Decision D1: reject non-ISO-4217 currency codes (uppercase A–Z).
    currency: z
      .string()
      .refine(isIso4217Code, { message: 'Currency must be a valid ISO-4217 code.' })
      .optional(),
  })
  .refine(
    (v) =>
      v.minDistanceKm === undefined ||
      v.maxDistanceKm === undefined ||
      v.maxDistanceKm >= v.minDistanceKm,
    {
      message: 'Max distance must be greater than or equal to min distance.',
      path: ['maxDistanceKm'],
    },
  );

export type FeeBandInput = z.infer<typeof feeBandSchema>;
