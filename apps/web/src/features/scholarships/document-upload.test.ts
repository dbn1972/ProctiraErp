import { describe, expect, it } from 'vitest';

import {
  clientFileError,
  documentTypeLabel,
  missingRequiredDocuments,
  SCHOLARSHIP_DOCUMENT_MAX_BYTES,
} from './document-upload';

describe('scholarship document upload rules', () => {
  it('names the scheme slots', () => {
    expect(documentTypeLabel('income_certificate')).toBe('Income certificate');
  });

  it('rejects the wrong type and files over 10 MB', () => {
    expect(clientFileError({ type: 'text/plain', size: 12 })).toMatch(/PDF/);
    expect(
      clientFileError({ type: 'application/pdf', size: SCHOLARSHIP_DOCUMENT_MAX_BYTES + 1 }),
    ).toMatch(/10 MB/);
    expect(clientFileError({ type: 'image/png', size: 20 })).toBeNull();
  });

  it('lists required types that are still missing', () => {
    expect(missingRequiredDocuments(['income_certificate', 'marksheet'], ['marksheet'])).toEqual([
      'income_certificate',
    ]);
  });
});
