import { z } from 'zod';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** PRC-L076: one size/type contract for the photo picker and the upload route. */
export const STUDENT_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const STUDENT_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const STUDENT_PHOTO_TOO_LARGE_MESSAGE = 'Photo must be 2 MB or smaller.';
export const STUDENT_PHOTO_BAD_TYPE_MESSAGE = 'Choose a JPEG, PNG, or WebP photo.';

/** Returns a user-facing problem with a picked photo, or null when it is acceptable. */
export function studentPhotoProblem(file: { size: number; type: string }): string | null {
  if (!(STUDENT_PHOTO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return STUDENT_PHOTO_BAD_TYPE_MESSAGE;
  }
  if (file.size === 0) return 'Photo is required';
  if (file.size > STUDENT_PHOTO_MAX_BYTES) return STUDENT_PHOTO_TOO_LARGE_MESSAGE;
  return null;
}

export const studentPhotoUploadSchema = z.object({
  contentBase64: z.string().min(1, 'Photo is required'),
  mimeType: z.enum(STUDENT_PHOTO_MIME_TYPES),
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
