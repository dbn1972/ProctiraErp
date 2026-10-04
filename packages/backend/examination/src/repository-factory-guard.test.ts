/**
 * PRC-L303 — every examination repository factory must fail closed in
 * production when no DATABASE_URL is configured (no silent in-memory fallback).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDocumentRepository,
  createExaminationRepository,
  createExamOpsStore,
  createResultRepository,
} from './repository-factory.js';

const KEYS = ['DATABASE_URL', 'NODE_ENV', 'REQUIRE_DATABASE'] as const;

describe('repository factories production guard (PRC-L303)', () => {
  const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};
  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    delete process.env['DATABASE_URL'];
    delete process.env['REQUIRE_DATABASE'];
    process.env['NODE_ENV'] = 'production';
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it.each([
    ['examination', () => createExaminationRepository()],
    ['result', () => createResultRepository()],
    ['document', () => createDocumentRepository()],
    ['ops store', () => createExamOpsStore()],
  ])('%s factory throws without DATABASE_URL in production', (_name, factory) => {
    expect(factory).toThrow(/in-memory store is not allowed/);
  });
});
