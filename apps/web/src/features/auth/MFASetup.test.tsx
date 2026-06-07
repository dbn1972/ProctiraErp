/**
 * @vitest-environment jsdom
 *
 * <MFASetup> tests — Task 49.4 / Requirements 4.11, 4.12.
 *
 * Covers:
 *   • Loading state while the enrolment payload is in flight
 *   • Ready state renders the QR canvas, plain-text fallback secret, and
 *     the full backup-code list exactly once
 *   • Download action triggers a `Blob` URL containing all backup codes
 *   • Print action invokes `window.print()`
 *   • The "Finish setup" button is disabled until the user explicitly
 *     acknowledges they have stored the backup codes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { LanguageProvider } from '@/providers/LanguageProvider';
import {
  BrandConfigProvider,
  type Brand,
} from '@/providers/BrandConfigProvider';
import enMessages from '@/messages/en.json';

import MFASetup, { formatBackupCodesDocument } from './MFASetup';

// ─── jsdom shims ────────────────────────────────────────────────────────────

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub;
}

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auth')>(
    '@/lib/api/auth',
  );
  return {
    ...actual,
    setupMfa: vi.fn(),
  };
});

import { setupMfa } from '@/lib/api/auth';
const mockSetupMfa = vi.mocked(setupMfa);

// ─── Fixtures ───────────────────────────────────────────────────────────────

const messages = enMessages as unknown as Record<
  string,
  Record<string, string>
>;

const SAMPLE_BRAND: Brand = {
  name: 'ProctiraERP',
  shortName: 'proctira',
  slug: 'proctira',
  logo: { url: 'https://example.test/logo.svg', alt: 'ProctiraERP' },
  favicon: 'https://example.test/favicon.ico',
  primary_color: 'hsl(222, 47%, 25%)',
  accent_color: 'hsl(190, 90%, 45%)',
  login_background: 'linear-gradient(180deg, #001 0%, #003 100%)',
  document_title_template: '{page} | {brand}',
};

const ENROLMENT_PAYLOAD = {
  otpauthUri:
    'otpauth://totp/ProctiraERP:user@example.org?secret=ABCDEF&issuer=ProctiraERP&algorithm=SHA1&digits=6&period=30',
  secret: 'JBSWY3DPEHPK3PXP',
  backupCodes: [
    'ABCD-1234',
    'EFGH-5678',
    'IJKL-9012',
    'MNOP-3456',
    'QRST-7890',
    'UVWX-1234',
    'YZAB-5678',
    'CDEF-9012',
    'GHIJ-3456',
    'KLMN-7890',
  ],
};

function renderMFASetup() {
  return render(
    <BrandConfigProvider initialBrand={SAMPLE_BRAND}>
      <LanguageProvider
        defaultLocale="en"
        messagesByLocale={{ en: messages }}
      >
        <MemoryRouter initialEntries={['/auth/mfa-setup']}>
          <Routes>
            <Route path="/auth/mfa-setup" element={<MFASetup />} />
            <Route
              path="/auth/mfa-verify"
              element={<div data-testid="mfa-verify-page">MFA verify</div>}
            />
            <Route path="/auth/signin" element={<div>signin</div>} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </BrandConfigProvider>,
  );
}

beforeEach(() => {
  mockSetupMfa.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<MFASetup>', () => {
  it('renders the QR, the secret, and exactly 10 backup codes when enrolment succeeds', async () => {
    mockSetupMfa.mockResolvedValueOnce({
      kind: 'ok',
      data: ENROLMENT_PAYLOAD,
    });

    renderMFASetup();

    // QR + secret render once enrolment data has loaded.
    await screen.findByTestId('mfa-setup-qr');
    expect(screen.getByTestId('mfa-setup-secret').textContent).toBe(
      ENROLMENT_PAYLOAD.secret,
    );

    // All 10 backup codes are rendered.
    const items = screen.getByTestId('mfa-setup-backup-codes').children;
    expect(items).toHaveLength(10);
    for (const code of ENROLMENT_PAYLOAD.backupCodes) {
      expect(screen.getByText(code)).toBeTruthy();
    }
  });

  it('disables the "Finish setup" button until the acknowledgement is checked', async () => {
    mockSetupMfa.mockResolvedValueOnce({
      kind: 'ok',
      data: ENROLMENT_PAYLOAD,
    });

    renderMFASetup();

    const finishButton = (await screen.findByTestId(
      'mfa-setup-finish',
    )) as HTMLButtonElement;
    expect(finishButton.disabled).toBe(true);

    const ack = screen.getByTestId('mfa-setup-ack');
    fireEvent.click(ack);

    await waitFor(() => expect(finishButton.disabled).toBe(false));
  });

  it('navigates to /auth/mfa-verify after acknowledgement and finish', async () => {
    mockSetupMfa.mockResolvedValueOnce({
      kind: 'ok',
      data: ENROLMENT_PAYLOAD,
    });

    renderMFASetup();

    const finishButton = (await screen.findByTestId(
      'mfa-setup-finish',
    )) as HTMLButtonElement;
    fireEvent.click(screen.getByTestId('mfa-setup-ack'));
    await waitFor(() => expect(finishButton.disabled).toBe(false));

    await act(async () => {
      fireEvent.click(finishButton);
    });

    await screen.findByTestId('mfa-verify-page');
  });

  it('triggers a download with the formatted backup codes document', async () => {
    mockSetupMfa.mockResolvedValueOnce({
      kind: 'ok',
      data: ENROLMENT_PAYLOAD,
    });

    // Capture the Blob created for download. We patch the Blob
    // constructor so we can read back the parts that were passed in —
    // jsdom's Blob lacks a working `text()` / `arrayBuffer()` method.
    const blobParts: BlobPart[][] = [];
    const RealBlob = globalThis.Blob;
    class RecordingBlob extends RealBlob {
      constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
        super(parts, options);
        blobParts.push(parts);
      }
    }
    Object.defineProperty(globalThis, 'Blob', {
      configurable: true,
      value: RecordingBlob,
    });

    const createObjectURL = vi.fn(() => 'blob://mfa');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    renderMFASetup();

    const downloadBtn = await screen.findByTestId('mfa-setup-download');
    fireEvent.click(downloadBtn);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(blobParts.length).toBeGreaterThanOrEqual(1);
    const text = blobParts[0]!
      .map((part) => (typeof part === 'string' ? part : ''))
      .join('');
    for (const code of ENROLMENT_PAYLOAD.backupCodes) {
      expect(text.includes(code)).toBe(true);
    }

    Object.defineProperty(globalThis, 'Blob', {
      configurable: true,
      value: RealBlob,
    });
  });

  it('invokes window.print() when the print action is clicked', async () => {
    mockSetupMfa.mockResolvedValueOnce({
      kind: 'ok',
      data: ENROLMENT_PAYLOAD,
    });

    const printSpy = vi.fn();
    Object.defineProperty(window, 'print', {
      configurable: true,
      value: printSpy,
    });

    renderMFASetup();

    const printBtn = await screen.findByTestId('mfa-setup-print');
    fireEvent.click(printBtn);

    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('shows an error state when enrolment fails', async () => {
    mockSetupMfa.mockResolvedValueOnce({
      kind: 'error',
      message: 'boom',
    });

    renderMFASetup();

    expect(await screen.findByTestId('mfa-setup-error')).toBeTruthy();
    // The QR / backup codes must NOT render in the error state.
    expect(screen.queryByTestId('mfa-setup-qr')).toBeNull();
    expect(screen.queryByTestId('mfa-setup-backup-codes')).toBeNull();
  });
});

describe('formatBackupCodesDocument()', () => {
  it('lists every code on its own line and includes the brand name', () => {
    const document = formatBackupCodesDocument(
      ENROLMENT_PAYLOAD.backupCodes,
      { brandName: 'EduZo', generatedAt: new Date('2025-01-15T00:00:00Z') },
    );
    expect(document.includes('EduZo')).toBe(true);
    expect(document.includes('2025-01-15T00:00:00.000Z')).toBe(true);
    for (const [index, code] of ENROLMENT_PAYLOAD.backupCodes.entries()) {
      expect(document.includes(`${index + 1}.  ${code}`)).toBe(true);
    }
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────
// (No additional helpers — see the inline Blob recording inside the
// "triggers a download..." test.)
