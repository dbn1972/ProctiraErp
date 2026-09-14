import { PAGINATION_DEFAULTS } from '@proctira/common';
import { describe, expect, it } from 'vitest';

import { resolvePaginationQuery, validatePaginationQuery } from './pagination-query.js';

describe('validatePaginationQuery (W3-D1 pagination caps)', () => {
  it('skips validation when neither page nor pageSize is present', () => {
    const result = validatePaginationQuery({});
    expect(result).toEqual({ success: true, skipped: true });
  });

  it('accepts pageSize at the platform max', () => {
    const result = validatePaginationQuery({ pageSize: '100' });
    expect(result.success).toBe(true);
    if (result.success && !('skipped' in result)) {
      expect(result.data.pageSize).toBe(PAGINATION_DEFAULTS.MAX_PAGE_SIZE);
    }
  });

  it('rejects pageSize above the platform max', () => {
    const result = validatePaginationQuery({ pageSize: '500' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.field === 'pageSize')).toBe(true);
    }
  });

  it('rejects invalid page values', () => {
    const result = validatePaginationQuery({ page: '0' });
    expect(result.success).toBe(false);
  });

  it('documents that manual Number() parsing accepts unbounded pageSize', () => {
    const legacyPageSize = Number('9999') || 20;
    expect(legacyPageSize).toBe(9999);
    expect(legacyPageSize).toBeGreaterThan(PAGINATION_DEFAULTS.MAX_PAGE_SIZE);
  });
});

describe('resolvePaginationQuery', () => {
  it('applies defaults when params are omitted', () => {
    const result = resolvePaginationQuery({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        page: PAGINATION_DEFAULTS.PAGE,
        pageSize: PAGINATION_DEFAULTS.PAGE_SIZE,
      });
    }
  });

  it('caps pageSize via schema maximum', () => {
    const result = resolvePaginationQuery({ pageSize: '250' });
    expect(result.success).toBe(false);
  });
});
