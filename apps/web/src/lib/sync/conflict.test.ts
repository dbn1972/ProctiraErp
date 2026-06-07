/**
 * apps/web/src/lib/sync/conflict.test.ts — 409 conflict envelope parser
 * + resolution merger.
 * Task 54.5 / Requirement 38.7 / Design §I.
 * =====================================================================
 *
 * Pure-logic tests for the conflict module:
 *
 *   • `parseConflictPayload` accepts the bare envelope, the
 *     `ApiError`-wrapped envelope, and a `details`-nested variant;
 *     rejects malformed JSON, missing fields, and shapes that don't
 *     match the contract.
 *
 *   • `parseLocalPayload` round-trips JSON bodies and returns the raw
 *     string when parsing fails so the dialog can still display
 *     something to the user.
 *
 *   • `mergeResolutions` is pure (does not mutate the input), respects
 *     each per-field choice, and supports nested dotted paths.
 */

import { describe, expect, it } from 'vitest';

import {
  mergeResolutions,
  parseConflictPayload,
  parseLocalPayload,
  type ConflictPayload,
  type FieldConflict,
} from './conflict';

const sampleConflicts: FieldConflict[] = [
  {
    field: 'studentName',
    server_value: 'Aisha Khan',
    server_version: 'v3',
    client_value: 'Aisha K.',
  },
  {
    field: 'gradeLevel',
    server_value: 5,
    server_version: 'v3',
    client_value: 6,
  },
];

const samplePayload: ConflictPayload = {
  field_conflicts: sampleConflicts,
  server_record: { id: 's1', studentName: 'Aisha Khan', gradeLevel: 5 },
  resolution_token: 'tok-abc-123',
};

// ─── parseConflictPayload ────────────────────────────────────────────────────

describe('parseConflictPayload', () => {
  it('parses the bare envelope shape', () => {
    const raw = JSON.stringify(samplePayload);
    const parsed = parseConflictPayload(raw);
    expect(parsed).toEqual(samplePayload);
  });

  it('parses the ApiError-wrapped envelope', () => {
    const raw = JSON.stringify({
      error: {
        code: 'CONFLICT_OPTIMISTIC',
        message: 'Record was modified by another user',
        details: samplePayload,
      },
    });
    const parsed = parseConflictPayload(raw);
    expect(parsed).toEqual(samplePayload);
  });

  it('parses the details-nested variant', () => {
    const raw = JSON.stringify({ details: samplePayload });
    const parsed = parseConflictPayload(raw);
    expect(parsed).toEqual(samplePayload);
  });

  it('returns null for malformed JSON', () => {
    expect(parseConflictPayload('{bad')).toBeNull();
  });

  it('returns null for an empty body', () => {
    expect(parseConflictPayload('')).toBeNull();
  });

  it('returns null when field_conflicts is missing', () => {
    const raw = JSON.stringify({
      server_record: {},
      resolution_token: 'tok',
    });
    expect(parseConflictPayload(raw)).toBeNull();
  });

  it('returns null when field_conflicts entries are malformed', () => {
    const raw = JSON.stringify({
      field_conflicts: [{ field: 'x' /* missing server_version */ }],
      server_record: {},
      resolution_token: 'tok',
    });
    expect(parseConflictPayload(raw)).toBeNull();
  });

  it('returns null when resolution_token is not a string', () => {
    const raw = JSON.stringify({
      field_conflicts: sampleConflicts,
      server_record: {},
      resolution_token: 123,
    });
    expect(parseConflictPayload(raw)).toBeNull();
  });

  it('accepts a null server_record (delete conflict)', () => {
    const raw = JSON.stringify({
      field_conflicts: [],
      server_record: null,
      resolution_token: 'tok',
    });
    const parsed = parseConflictPayload(raw);
    expect(parsed?.server_record).toBeNull();
  });
});

// ─── parseLocalPayload ──────────────────────────────────────────────────────

describe('parseLocalPayload', () => {
  it('parses a valid JSON body into an object', () => {
    const result = parseLocalPayload(JSON.stringify({ a: 1 }));
    expect(result).toEqual({ a: 1 });
  });

  it('returns null for null/undefined/empty bodies', () => {
    expect(parseLocalPayload(null)).toBeNull();
    expect(parseLocalPayload(undefined)).toBeNull();
    expect(parseLocalPayload('')).toBeNull();
  });

  it('returns the raw string when JSON parsing fails so the user still sees the body', () => {
    expect(parseLocalPayload('not json')).toBe('not json');
  });
});

// ─── mergeResolutions ──────────────────────────────────────────────────────

describe('mergeResolutions', () => {
  it('keeps the local value when the resolution is "client" (default)', () => {
    const local = { studentName: 'Aisha K.', gradeLevel: 6 };
    const merged = mergeResolutions(local, sampleConflicts, {
      studentName: 'client',
      gradeLevel: 'client',
    });
    expect(merged).toEqual(local);
  });

  it('replaces the field with the server value when the resolution is "server"', () => {
    const local = { studentName: 'Aisha K.', gradeLevel: 6 };
    const merged = mergeResolutions(local, sampleConflicts, {
      studentName: 'server',
      gradeLevel: 'client',
    });
    expect(merged).toEqual({ studentName: 'Aisha Khan', gradeLevel: 6 });
  });

  it('treats missing entries in the resolution map as "client"', () => {
    const local = { studentName: 'Aisha K.', gradeLevel: 6 };
    const merged = mergeResolutions(local, sampleConflicts, {});
    expect(merged).toEqual(local);
  });

  it('does not mutate the input payload', () => {
    const local = { studentName: 'Aisha K.', gradeLevel: 6 };
    const snapshot = JSON.stringify(local);
    mergeResolutions(local, sampleConflicts, {
      studentName: 'server',
      gradeLevel: 'server',
    });
    expect(JSON.stringify(local)).toBe(snapshot);
  });

  it('supports nested dotted-path fields', () => {
    const local = { address: { city: 'Pune', zip: '411001' } };
    const conflicts: FieldConflict[] = [
      {
        field: 'address.city',
        server_value: 'Mumbai',
        server_version: 'v2',
        client_value: 'Pune',
      },
    ];
    const merged = mergeResolutions(local, conflicts, { 'address.city': 'server' });
    expect(merged).toEqual({ address: { city: 'Mumbai', zip: '411001' } });
  });

  it('returns the input unchanged when the local payload is not an object', () => {
    expect(mergeResolutions('raw text', sampleConflicts, {})).toBe('raw text');
    expect(mergeResolutions(null, sampleConflicts, {})).toBeNull();
    expect(mergeResolutions(42, sampleConflicts, {})).toBe(42);
  });
});
