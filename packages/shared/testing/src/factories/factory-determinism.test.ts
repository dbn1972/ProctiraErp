/**
 * PRC-L587 — factory PII must use reserved/obviously-fake markers.
 * PRC-L498 — createBoardList must not clobber defaults with undefined; seedFactories
 *            makes faker output deterministic.
 */
import { describe, it, expect } from 'vitest';

import { createStudent, createBoard, createBoardList, seedFactories } from './index.js';

describe('student factory PII markers (PRC-L587)', () => {
  it('uses a reserved national-id marker and the .test reserved email domain', () => {
    const s = createStudent();
    expect(s.nationalId.startsWith('TEST-')).toBe(true);
    expect(s.email.endsWith('.test')).toBe(true);
  });
});

describe('createBoardList (PRC-L498)', () => {
  it('keeps factory defaults when no code/name override is given (no undefined clobber)', () => {
    const boards = createBoardList(3);
    for (const b of boards) {
      expect(b.code).toBeTruthy();
      expect(b.name).toBeTruthy();
      expect(b.code).not.toBe('undefined');
    }
  });

  it('suffixes provided code/name per item', () => {
    const boards = createBoardList(2, { code: 'CBSE', name: 'Central Board' });
    expect(boards[0]!.code).toBe('CBSE1');
    expect(boards[1]!.code).toBe('CBSE2');
    expect(boards[0]!.name).toBe('Central Board 1');
  });
});

describe('seedFactories determinism (PRC-L498)', () => {
  it('produces identical factory output for the same seed', () => {
    seedFactories(42);
    const a = createBoard();
    seedFactories(42);
    const b = createBoard();
    expect(a.name).toBe(b.name);
    expect(a.type).toBe(b.type);
  });
});
