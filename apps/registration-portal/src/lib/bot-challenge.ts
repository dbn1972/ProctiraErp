/**
 * PRC-M332 — client side of the registration bot control.
 *
 * Before submitting, the portal fetches a signed proof-of-work challenge from
 * `GET /registrations/challenge` and searches for a counter whose
 * `SHA-256(nonce|counter)` starts with `difficulty` zero bits (WebCrypto, no
 * third party, no visual CAPTCHA). The solution travels in the
 * `x-registration-challenge` header of the submit request.
 */

export interface RegistrationChallenge {
  nonce: string;
  difficulty: number;
  expiresAt: number;
  sig: string;
}

/** Header carrying the solved challenge on submit. */
export const REGISTRATION_CHALLENGE_HEADER = 'x-registration-challenge';

/** Hard cap on difficulty accepted from the server (matches the backend maximum). */
const MAX_DIFFICULTY = 24;
const TOKEN_VERSION = 'v1';

/** Count leading zero bits of a digest. */
export function leadingZeroBits(digest: Uint8Array): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

/** Narrow an unknown JSON body to a challenge, or null when it is not one. */
export function parseRegistrationChallenge(value: unknown): RegistrationChallenge | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v['nonce'] !== 'string' ||
    typeof v['sig'] !== 'string' ||
    typeof v['difficulty'] !== 'number' ||
    !Number.isInteger(v['difficulty']) ||
    v['difficulty'] < 0 ||
    v['difficulty'] > MAX_DIFFICULTY ||
    typeof v['expiresAt'] !== 'number'
  ) {
    return null;
  }
  return {
    nonce: v['nonce'],
    sig: v['sig'],
    difficulty: v['difficulty'],
    expiresAt: v['expiresAt'],
  };
}

export type Sha256 = (input: string) => Promise<Uint8Array>;

/** WebCrypto SHA-256 (browser and Node 20+). */
export const webCryptoSha256: Sha256 = async (input) =>
  new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));

/**
 * Find the proof-of-work solution and return the header value. Yields to the
 * event loop periodically so the page stays responsive while it works.
 */
export async function solveRegistrationChallenge(
  challenge: RegistrationChallenge,
  options: { sha256?: Sha256; maxIterations?: number; yieldEvery?: number } = {},
): Promise<string> {
  const sha256 = options.sha256 ?? webCryptoSha256;
  const maxIterations = options.maxIterations ?? 50_000_000;
  const yieldEvery = options.yieldEvery ?? 2_000;
  for (let counter = 0; counter < maxIterations; counter += 1) {
    const digest = await sha256(`${challenge.nonce}|${counter}`);
    if (leadingZeroBits(digest) >= challenge.difficulty) {
      return [
        TOKEN_VERSION,
        challenge.nonce,
        challenge.difficulty,
        challenge.expiresAt,
        challenge.sig,
        counter,
      ].join('.');
    }
    if (counter > 0 && counter % yieldEvery === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw new Error('Bot challenge could not be solved');
}
