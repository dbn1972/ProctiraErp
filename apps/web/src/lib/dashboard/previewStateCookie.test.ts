import { describe, expect, it } from 'vitest';

import {
  PREVIEW_STATE_MAX_AGE_SECONDS,
  PREVIEW_STATES,
  decodePreviewStateCookieValue,
  encodePreviewStateCookieValue,
  isPreviewStateExpired,
  type PreviewState,
} from './previewStateCookie';

describe('previewStateCookie encode/decode round-trip', () => {
  it.each(PREVIEW_STATES)('round-trips the "%s" state', (state: PreviewState) => {
    const encoded = encodePreviewStateCookieValue(state, 1719400000);
    expect(encoded).toBe(`${state}|1719400000`);
    expect(decodePreviewStateCookieValue(encoded)).toEqual({
      state,
      setAtEpochSeconds: 1719400000,
    });
  });

  it('defaults setAtEpochSeconds to the current time when omitted', () => {
    const before = Math.floor(Date.now() / 1000);
    const decoded = decodePreviewStateCookieValue(encodePreviewStateCookieValue('filled'));
    const after = Math.floor(Date.now() / 1000);
    expect(decoded).not.toBeNull();
    expect(decoded!.setAtEpochSeconds).toBeGreaterThanOrEqual(before);
    expect(decoded!.setAtEpochSeconds).toBeLessThanOrEqual(after);
  });
});

describe('previewStateCookie decode failure modes (fail closed)', () => {
  it('returns null for undefined/null/empty input', () => {
    expect(decodePreviewStateCookieValue(undefined)).toBeNull();
    expect(decodePreviewStateCookieValue(null)).toBeNull();
    expect(decodePreviewStateCookieValue('')).toBeNull();
  });

  it('returns null for the wrong separator count', () => {
    expect(decodePreviewStateCookieValue('filled')).toBeNull(); // no `|`
    expect(decodePreviewStateCookieValue('filled|1719400000|extra')).toBeNull(); // too many
    expect(decodePreviewStateCookieValue('|1719400000')).toBeNull(); // empty state part
    expect(decodePreviewStateCookieValue('filled|')).toBeNull(); // empty epoch part
  });

  it('returns null for an unknown state string', () => {
    expect(decodePreviewStateCookieValue('bogus-state|1719400000')).toBeNull();
    expect(decodePreviewStateCookieValue('Filled|1719400000')).toBeNull(); // case-sensitive
  });

  it('returns null for a non-numeric or non-positive epoch', () => {
    expect(decodePreviewStateCookieValue('filled|not-a-number')).toBeNull();
    expect(decodePreviewStateCookieValue('filled|12abc')).toBeNull();
    expect(decodePreviewStateCookieValue('filled|-5')).toBeNull();
    expect(decodePreviewStateCookieValue('filled|0')).toBeNull();
    expect(decodePreviewStateCookieValue('filled|1.5')).toBeNull();
    expect(decodePreviewStateCookieValue('filled|NaN')).toBeNull();
    expect(decodePreviewStateCookieValue('filled|Infinity')).toBeNull();
  });

  it('never throws on malformed input', () => {
    expect(() => decodePreviewStateCookieValue('||||')).not.toThrow();
    expect(() => decodePreviewStateCookieValue('\u0000')).not.toThrow();
  });
});

describe('isPreviewStateExpired', () => {
  const setAt = 1719400000;

  it('is false just under the 1800s boundary', () => {
    expect(isPreviewStateExpired(setAt, setAt + PREVIEW_STATE_MAX_AGE_SECONDS - 1)).toBe(false);
  });

  it('is false exactly at the 1800s boundary', () => {
    expect(isPreviewStateExpired(setAt, setAt + PREVIEW_STATE_MAX_AGE_SECONDS)).toBe(false);
  });

  it('is true just over the 1800s boundary', () => {
    expect(isPreviewStateExpired(setAt, setAt + PREVIEW_STATE_MAX_AGE_SECONDS + 1)).toBe(true);
  });

  it('defaults nowEpochSeconds to the current time when omitted', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isPreviewStateExpired(now)).toBe(false);
    expect(isPreviewStateExpired(now - PREVIEW_STATE_MAX_AGE_SECONDS - 60)).toBe(true);
  });
});
