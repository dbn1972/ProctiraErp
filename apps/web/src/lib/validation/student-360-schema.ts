import { z } from 'zod';
import { base64MaxBytes } from './zod-helpers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const studentPhotoUploadSchema = z.object({
  // PRC-M494: mirrors the backend PHOTO_MAX_BYTES (2 MB).
  contentBase64: base64MaxBytes(2 * 1024 * 1024, 'Photo'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});
export type StudentPhotoUploadValues = z.infer<typeof studentPhotoUploadSchema>;

export const studentSiblingSchema = z.object({
  siblingId: z.string().regex(UUID, 'Sibling must be a valid student id'),
});
export type StudentSiblingValues = z.infer<typeof studentSiblingSchema>;

export const studentConsentSchema = z.object({
  kind: z.enum(['photo', 'medical', 'trips', 'data_sharing']),
  granted: z.boolean(),
});
export type StudentConsentValues = z.infer<typeof studentConsentSchema>;

export const studentDisciplineSchema = z.object({
  incidentType: z.string().min(1, 'Incident type is required').max(80),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  description: z.string().min(1, 'Description is required').max(4000),
  actionTaken: z.string().max(2000).optional().or(z.literal('')),
  incidentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date is required'),
  visibleToParent: z.boolean().optional(),
});
export type StudentDisciplineValues = z.infer<typeof studentDisciplineSchema>;
