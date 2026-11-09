/**
 * PRC-M332 — the portal solves the gateway's proof-of-work challenge and sends
 * it with the submit request.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { submitRegistration, type RegistrationRequestInit } from './api';
import {
  leadingZeroBits,
  parseRegistrationChallenge,
  REGISTRATION_CHALLENGE_HEADER,
  solveRegistrationChallenge,
} from './bot-challenge';

const challenge = { nonce: 'n'.repeat(24), difficulty: 8, expiresAt: 1_900_000_000_000, sig: 's' };

describe('PRC-M332 portal proof-of-work', () => {
  it('finds a counter whose SHA-256 meets the difficulty (WebCrypto)', async () => {
    const token = await solveRegistrationChallenge(challenge);
    const parts = token.split('.');
    expect(parts.slice(0, 5)).toEqual([
      'v1',
      challenge.nonce,
      '8',
      String(challenge.expiresAt),
      challenge.sig,
    ]);
    const digest = createHash('sha256').update(`${challenge.nonce}|${parts[5]}`).digest();
    expect(leadingZeroBits(digest)).toBeGreaterThanOrEqual(8);
  });

  it('rejects malformed or over-hard challenge bodies', () => {
    expect(parseRegistrationChallenge({ ...challenge, difficulty: 40 })).toBeNull();
    expect(parseRegistrationChallenge({ nonce: 1 })).toBeNull();
    expect(parseRegistrationChallenge(challenge)).toEqual(challenge);
  });
});

describe('PRC-M332 submitRegistration sends the solved challenge', () => {
  const payload = {
    institutionId: 'i',
    formConfigurationId: 'f',
    formConfigurationVersion: 1,
    firstName: 'A',
    lastName: 'B',
    dateOfBirth: '2013-01-01',
    gender: 'other' as const,
    guardianName: 'G',
    guardianPhone: '+1-555-0100',
  };
  const created = { id: 'x', trackingNumber: 'T-1', status: 'pending' };

  function recordingTransport(challengeResponse: Response) {
    const calls: Array<{ path: string; init?: RegistrationRequestInit }> = [];
    const transport = async (path: string, init?: RegistrationRequestInit) => {
      calls.push({ path, init });
      if (path === '/registrations/challenge') return challengeResponse;
      return Response.json(created, { status: 201 });
    };
    return { calls, transport };
  }

  it('fetches a challenge, solves it and sends x-registration-challenge', async () => {
    const { calls, transport } = recordingTransport(Response.json(challenge));
    const result = await submitRegistration(payload, 'key-123456789', transport, async (c) =>
      solveRegistrationChallenge(c),
    );
    expect(result.trackingNumber).toBe('T-1');
    expect(calls.map((c) => c.path)).toEqual(['/registrations/challenge', '/registrations']);
    const header = calls[1]!.init!.headers![REGISTRATION_CHALLENGE_HEADER];
    expect(header).toMatch(/^v1\./);
  });

  it('a portal without a configured challenge (404) submits without the header', async () => {
    const { calls, transport } = recordingTransport(
      Response.json({ code: 'CHALLENGE_DISABLED' }, { status: 404 }),
    );
    await submitRegistration(payload, 'key-123456789', transport);
    expect(calls[1]!.init!.headers![REGISTRATION_CHALLENGE_HEADER]).toBeUndefined();
  });

  it('a challenge outage is surfaced (no unchallenged submit)', async () => {
    const { calls, transport } = recordingTransport(
      Response.json({ code: 'TOO_MANY_REQUESTS', message: 'Too many attempts.' }, { status: 429 }),
    );
    await expect(submitRegistration(payload, 'key-123456789', transport)).rejects.toMatchObject({
      statusCode: 429,
    });
    expect(calls).toHaveLength(1);
  });
});
