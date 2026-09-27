import { describe, expect, it } from 'vitest';

import { examinationCandidateLabel, offerFeeInvoiceStatus } from './display-references';

const UUID = '33333333-3333-4333-8333-333333333333';

describe('display references', () => {
  it('says the offer fee invoice is ready without printing its id', () => {
    expect(offerFeeInvoiceStatus(UUID)).toBe('Fee invoice ready');
    expect(offerFeeInvoiceStatus(null)).toBe('No invoice yet');
    expect(offerFeeInvoiceStatus('   ')).toBe('No invoice yet');
  });

  it('labels an exam candidate from the student directory', () => {
    expect(examinationCandidateLabel('ADM-9 · Ada Lovelace')).toBe('ADM-9 · Ada Lovelace');
    expect(examinationCandidateLabel(undefined)).toBe('Candidate');
    expect(examinationCandidateLabel('  ')).toBe('Candidate');
    expect(examinationCandidateLabel(undefined)).not.toContain(UUID.slice(0, 8));
  });
});
