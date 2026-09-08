/**
 * Task 49.7 — E2E: MFA enrolment (QR code + backup codes).
 *
 * The MFA setup surface is the first-time TOTP enrolment screen
 * (`<MFASetup>`, design.md §D — MFA Setup flow). It calls
 * `POST /api/auth/mfa/setup` to retrieve the QR (otpauth URI), the
 * fallback secret, and ten one-time backup codes, then gates the
 * "Finish setup" CTA behind an explicit acknowledgement so the user
 * can't dismiss the panel without confirming they have stored the
 * codes safely (Requirement 4 AC 12).
 *
 * Asserts:
 *   • The QR canvas, the fallback secret, and exactly 10 backup codes
 *     render on a successful enrolment fetch.
 *   • The "Finish setup" button is disabled until the acknowledgement
 *     checkbox is ticked.
 *   • Axe AA scan on the loaded surface.
 *
 * Some deploys do not surface this route in the Next.js routing layer
 * (it is mounted via the federated `RootRouter` for SPA mode). When
 * the Next.js server replies with 404 we skip with a clear reason —
 * this matches the pattern used in `a11y-axe.spec.ts` for `/signup`.
 *
 * Requirements: 4.11, 4.12
 * Design: D
 */
import { expect, test } from '@playwright/test';

import { runAxe } from '../helpers/axe';

const SETUP_PATHS = ['/auth/mfa-setup', '/mfa-setup', '/mfa/setup'];

const SETUP_PAYLOAD = {
  otpauthUri:
    'otpauth://totp/ProctiraERP:user@proctira?secret=JBSWY3DPEHPK3PXP&issuer=ProctiraERP&algorithm=SHA1&digits=6&period=30',
  secret: 'JBSWY3DPEHPK3PXP',
  backupCodes: [
    'AAAA-0001',
    'AAAA-0002',
    'AAAA-0003',
    'AAAA-0004',
    'AAAA-0005',
    'AAAA-0006',
    'AAAA-0007',
    'AAAA-0008',
    'AAAA-0009',
    'AAAA-0010',
  ],
};

/**
 * Walks the candidate paths and returns the first one that responds
 * 2xx; returns `null` when none are available so the spec can skip.
 */
async function findSetupRoute(page: import('@playwright/test').Page): Promise<string | null> {
  for (const path of SETUP_PATHS) {
    const response = await page.goto(path);
    if (response && response.status() < 400) {
      return path;
    }
  }
  return null;
}

test.describe('auth — MFA setup (QR + backup codes)', () => {
  test('renders QR, secret, and 10 backup codes; finish CTA gated on acknowledgement', async ({
    page,
  }) => {
    // Mock the upstream enrolment endpoint. We match both the local
    // route handler shape and the upstream contract so the test is
    // robust whichever client path the screen takes.
    await page.route('**/api/auth/mfa/setup', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SETUP_PAYLOAD),
      });
    });
    await page.route('**/api/v1/auth/mfa/setup', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SETUP_PAYLOAD),
      });
    });

    const path = await findSetupRoute(page);
    test.skip(
      path === null,
      'MFA setup route is not available in this build (federated RootRouter only).',
    );

    // The QR + secret + backup-codes panels render once enrolment data
    // has loaded. We probe by `data-testid` selectors that the
    // `<MFASetup>` component exposes (see
    // `apps/web/src/features/auth/MFASetup.tsx`).
    const qr = page.getByTestId('mfa-setup-qr');
    const secret = page.getByTestId('mfa-setup-secret');
    const codes = page.getByTestId('mfa-setup-backup-codes');
    const finish = page.getByTestId('mfa-setup-finish');
    const ack = page.getByTestId('mfa-setup-ack');

    await expect(qr).toBeVisible();
    await expect(secret).toContainText(SETUP_PAYLOAD.secret);
    await expect(codes).toBeVisible();
    // Exactly 10 backup codes render.
    for (let i = 0; i < 10; i += 1) {
      await expect(page.getByTestId(`mfa-setup-backup-code-${i}`)).toBeVisible();
    }

    // The "Finish setup" button is disabled until the user
    // acknowledges they have saved the codes.
    await expect(finish).toBeDisabled();
    await ack.click();
    await expect(finish).toBeEnabled();

    // Axe AA gate on the loaded surface. Excludes the QR svg from
    // the scan because qrcode.react renders raw shapes that do not
    // satisfy `<svg>` titling rules — the QR is decorative and the
    // setup key is the canonical fallback.
    await runAxe(page, {
      checkpointLabel: 'mfa-setup (loaded)',
      exclude: '[data-testid="mfa-setup-qr"]',
    });
  });
});
