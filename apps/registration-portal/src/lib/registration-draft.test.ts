/**
 * Unit tests for registration draft persistence helpers.
 * Document bytes must never be written to sessionStorage.
 */
import { describe, expect, it } from 'vitest';
import { stripDocumentContent, toPersistedDraft } from './registration-draft';

describe('stripDocumentContent', () => {
  it('removes base64 content from document metadata', () => {
    const stripped = stripDocumentContent([
      {
        fileName: 'photo.jpg',
        fileType: 'image/jpeg',
        fileSize: 1024,
        documentType: 'photo',
        content: 'aGVsbG8=',
      },
    ]);
    expect(stripped).toEqual([
      {
        fileName: 'photo.jpg',
        fileType: 'image/jpeg',
        fileSize: 1024,
        documentType: 'photo',
      },
    ]);
    expect(stripped[0]).not.toHaveProperty('content');
  });

  it('is a no-op when content is already absent', () => {
    const input = [
      {
        fileName: 'birth.pdf',
        fileType: 'application/pdf',
        fileSize: 2048,
        documentType: 'birthCertificate',
      },
    ];
    expect(stripDocumentContent(input)).toEqual(input);
  });
});

describe('toPersistedDraft', () => {
  it('persists personal fields but strips document content', () => {
    const draft = {
      institutionType: 'primary',
      institutionId: '11111111-1111-4111-8111-111111111111',
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '2010-01-01',
      gender: 'female' as const,
      guardianName: 'Parent',
      guardianPhone: '+1234567890',
      guardianEmail: 'parent@example.com',
      customFields: {},
      documents: [
        {
          fileName: 'photo.jpg',
          fileType: 'image/jpeg',
          fileSize: 512,
          documentType: 'photo',
          content: 'YmFzZTY0',
        },
      ],
    };

    const persisted = toPersistedDraft(draft);
    expect(persisted.firstName).toBe('Ada');
    expect(persisted.documents[0]?.fileName).toBe('photo.jpg');
    expect(persisted.documents[0]).not.toHaveProperty('content');
    expect(JSON.stringify(persisted)).not.toContain('YmFzZTY0');
  });
});
