import { describe, expect, it } from 'vitest';

import { convertMarks } from './marks.js';
import { isIdempotentReplay } from './state-machine.js';
import {
  TRANSFER_DECISIONS,
  TRANSFER_STATUSES,
  nextStatus,
  type TransferDecision,
  type TransferWorkflowStatus,
} from './state-machine.js';

describe('transfer state machine', () => {
  const legal: Array<[TransferWorkflowStatus, TransferDecision, TransferWorkflowStatus]> = [
    ['DRAFT', 'SUBMIT', 'SUBMITTED'],
    ['DRAFT', 'CANCEL', 'CANCELLED'],
    ['SUBMITTED', 'START_REVIEW', 'UNDER_REVIEW'],
    ['SUBMITTED', 'CANCEL', 'CANCELLED'],
    ['UNDER_REVIEW', 'APPROVE', 'APPROVED'],
    ['UNDER_REVIEW', 'REJECT', 'REJECTED'],
    ['UNDER_REVIEW', 'CANCEL', 'CANCELLED'],
    ['APPROVED', 'COMPLETE', 'COMPLETED'],
    ['APPROVED', 'CANCEL', 'CANCELLED'],
  ];

  it('allows the documented transitions', () => {
    for (const [from, decision, to] of legal) {
      expect(nextStatus(from, decision)).toBe(to);
    }
  });

  it('rejects every other pair with 409', () => {
    const allowed = new Set(legal.map(([from, decision]) => `${from}:${decision}`));
    for (const from of TRANSFER_STATUSES) {
      for (const decision of TRANSFER_DECISIONS) {
        if (allowed.has(`${from}:${decision}`)) continue;
        expect(() => nextStatus(from, decision)).toThrow(/Cannot/);
      }
    }
  });
});

describe('convertMarks', () => {
  it('keeps CBSE 100 to ICSE 100 identity', () => {
    expect(convertMarks({ sourceMarks: 87, sourceMax: 100, targetMax: 100, creditFactor: 1 })).toBe(
      87,
    );
  });

  it('scales CBSE percentage onto a state-board 80-mark internal', () => {
    expect(convertMarks({ sourceMarks: 75, sourceMax: 100, targetMax: 80, creditFactor: 1 })).toBe(
      60,
    );
  });

  it('treats a repeated decision on the landed status as a replay', () => {
    expect(isIdempotentReplay('REJECTED', 'REJECT')).toBe(true);
    expect(isIdempotentReplay('UNDER_REVIEW', 'REJECT')).toBe(false);
    expect(isIdempotentReplay('COMPLETED', 'COMPLETE')).toBe(true);
    expect(isIdempotentReplay('APPROVED', 'REJECT')).toBe(false);
  });

  it('caps at the target scale', () => {
    expect(convertMarks({ sourceMarks: 100, sourceMax: 100, targetMax: 80, creditFactor: 2 })).toBe(
      80,
    );
  });
});
