import { describe, expect, it } from 'vitest';

import { isCampaignAudienceBroadcast, isParentVisibleGrade } from './academic-visibility.js';

describe('isCampaignAudienceBroadcast (PRC-H074)', () => {
  it('treats tenant-wide broadcasts as visible', () => {
    expect(isCampaignAudienceBroadcast({ scope: 'all' })).toBe(true);
    expect(isCampaignAudienceBroadcast({ scope: 'ALL' })).toBe(true);
    expect(isCampaignAudienceBroadcast({})).toBe(true);
    expect(isCampaignAudienceBroadcast({ scope: '' })).toBe(true);
    expect(isCampaignAudienceBroadcast(null)).toBe(true);
    expect(isCampaignAudienceBroadcast(undefined)).toBe(true);
  });

  it('withholds narrowly-targeted campaigns from the shared notices feed', () => {
    expect(isCampaignAudienceBroadcast({ scope: 'grade', grade: '5' })).toBe(false);
    expect(isCampaignAudienceBroadcast({ scope: 'hostel', hostelId: 'h1' })).toBe(false);
    expect(isCampaignAudienceBroadcast({ scope: 'route', routeId: 'r1' })).toBe(false);
    expect(isCampaignAudienceBroadcast({ scope: 'custom', ids: ['a', 'b'] })).toBe(false);
  });

  it('fails closed on malformed audience payloads', () => {
    expect(isCampaignAudienceBroadcast('all')).toBe(false);
    expect(isCampaignAudienceBroadcast(42)).toBe(false);
  });
});

describe('isParentVisibleGrade', () => {
  it('shows only published grades', () => {
    expect(isParentVisibleGrade({ workflowStatus: 'PUBLISHED', publishedAt: null })).toBe(true);
    expect(
      isParentVisibleGrade({ workflowStatus: 'LOCKED', publishedAt: '2026-09-22T00:00:00Z' }),
    ).toBe(true);
    expect(isParentVisibleGrade({ workflowStatus: 'LOCKED', publishedAt: null })).toBe(false);
    expect(isParentVisibleGrade({ workflowStatus: 'APPROVED', publishedAt: null })).toBe(false);
    expect(isParentVisibleGrade({ workflowStatus: 'DRAFT', publishedAt: null })).toBe(false);
    expect(isParentVisibleGrade({ workflowStatus: 'SUBMITTED', publishedAt: null })).toBe(false);
  });
});
