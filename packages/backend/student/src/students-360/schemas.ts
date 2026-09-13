/**
 * G-914 — Students 360: photo, siblings, consents, discipline, heatmap.
 */
import { Type, type Static } from '@sinclair/typebox';

export const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';

export const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const ALLOWED_PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedPhotoMime = (typeof ALLOWED_PHOTO_MIMES)[number];

export const CONSENT_KINDS = ['photo', 'medical', 'trips', 'data_sharing'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export const DISCIPLINE_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type DisciplineSeverity = (typeof DISCIPLINE_SEVERITIES)[number];

export const UploadPhotoSchema = Type.Object({
  contentBase64: Type.String({ minLength: 1, maxLength: 2_800_000 }),
  mimeType: Type.Union([
    Type.Literal('image/jpeg'),
    Type.Literal('image/png'),
    Type.Literal('image/webp'),
  ]),
});
export type UploadPhotoDto = Static<typeof UploadPhotoSchema>;

export const CreateSiblingSchema = Type.Object({
  siblingId: Type.String({ pattern: UUID_PATTERN }),
});
export type CreateSiblingDto = Static<typeof CreateSiblingSchema>;

export const SetConsentSchema = Type.Object({
  kind: Type.Union([
    Type.Literal('photo'),
    Type.Literal('medical'),
    Type.Literal('trips'),
    Type.Literal('data_sharing'),
  ]),
  granted: Type.Boolean(),
});
export type SetConsentDto = Static<typeof SetConsentSchema>;

export const CreateDisciplineSchema = Type.Object({
  incidentType: Type.String({ minLength: 1, maxLength: 80 }),
  severity: Type.Union([
    Type.Literal('low'),
    Type.Literal('medium'),
    Type.Literal('high'),
    Type.Literal('critical'),
  ]),
  description: Type.String({ minLength: 1, maxLength: 4000 }),
  actionTaken: Type.Optional(Type.String({ maxLength: 2000 })),
  incidentDate: Type.String({ pattern: DATE_PATTERN }),
  visibleToParent: Type.Optional(Type.Boolean()),
});
export type CreateDisciplineDto = Static<typeof CreateDisciplineSchema>;

export const HeatmapQuerySchema = Type.Object(
  {
    from: Type.Optional(Type.String({ pattern: DATE_PATTERN })),
    to: Type.Optional(Type.String({ pattern: DATE_PATTERN })),
  },
  { additionalProperties: true },
);
export type HeatmapQueryDto = Static<typeof HeatmapQuerySchema>;

/** W2-SIS-03 — general student document / blob registry (not profile photos). */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_CATEGORIES = [
  'birth_certificate',
  'transfer_certificate',
  'passport',
  'national_id',
  'medical',
  'address_proof',
  'previous_marksheet',
  'other',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const ALLOWED_DOCUMENT_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type AllowedDocumentMime = (typeof ALLOWED_DOCUMENT_MIMES)[number];

export const UploadDocumentSchema = Type.Object({
  category: Type.Union([
    Type.Literal('birth_certificate'),
    Type.Literal('transfer_certificate'),
    Type.Literal('passport'),
    Type.Literal('national_id'),
    Type.Literal('medical'),
    Type.Literal('address_proof'),
    Type.Literal('previous_marksheet'),
    Type.Literal('other'),
  ]),
  fileName: Type.String({ minLength: 1, maxLength: 255 }),
  mimeType: Type.Union([
    Type.Literal('application/pdf'),
    Type.Literal('image/jpeg'),
    Type.Literal('image/png'),
    Type.Literal('image/webp'),
  ]),
  contentBase64: Type.String({ minLength: 1, maxLength: 14_000_000 }),
});
export type UploadDocumentDto = Static<typeof UploadDocumentSchema>;

export const DocumentParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
  docId: Type.String({ pattern: UUID_PATTERN }),
});
export type DocumentParamsDto = Static<typeof DocumentParamsSchema>;
