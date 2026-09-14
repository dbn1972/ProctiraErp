import { describe, expect, it } from 'vitest';

import {
  assertCommunicationAccess,
  communicationActionForPath,
  hasCommunicationAccess,
  isCommunicationPortalPath,
  normalizeCommunicationRoles,
} from './communication-access.js';

describe('communication-access (W1-SEC-02)', () => {
  it('normalizes roles', () => {
    expect(normalizeCommunicationRoles(['Admin', { roleName: 'Communications_Officer' }])).toEqual([
      'admin',
      'communications_officer',
    ]);
  });

  it('allows staff; denies teacher on staff; portal needs user', () => {
    expect(hasCommunicationAccess(['communications_officer'], 'communication.staff')).toBe(true);
    expect(hasCommunicationAccess(['teacher'], 'communication.staff')).toBe(false);
    expect(hasCommunicationAccess(['parent'], 'communication.portal', { hasUser: true })).toBe(
      true,
    );
    expect(hasCommunicationAccess([], 'communication.portal', { hasUser: false })).toBe(false);
    expect(() => assertCommunicationAccess(['viewer'], 'communication.staff')).toThrow(
      /Forbidden/,
    );
  });

  it('classifies portal ack path', () => {
    expect(isCommunicationPortalPath('/communication/circulars/abc/ack')).toBe(true);
    expect(isCommunicationPortalPath('/communication/circulars')).toBe(false);
    expect(communicationActionForPath('/api/v1/communication/campaigns')).toBe(
      'communication.staff',
    );
  });
});
