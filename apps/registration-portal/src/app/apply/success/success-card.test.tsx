/**
 * PRC-L020 — copy feedback is announced (live region / alert) and labels come
 * from the locale catalog (no hard-coded English aria-labels).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { SuccessCard } from './success-card';

function renderCard(locale: 'en' | 'ar') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
      <SuccessCard />
    </NextIntlClientProvider>,
  );
}

describe('PRC-L020 SuccessCard copy feedback', () => {
  beforeEach(() => {
    window.sessionStorage.setItem('registration:lastTrackingNumber', 'REG-ABCD1234');
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it('announces success through a polite status region', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderCard('en');
    const button = await screen.findByRole('button', { name: en.registration.copyTrackingNumber });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(writeText).toHaveBeenCalledWith('REG-ABCD1234');
    expect(screen.getByRole('status').textContent).toBe(en.registration.trackingNumberCopied);
  });

  it('shows an alert when the clipboard write is rejected', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderCard('en');
    await act(async () => {
      fireEvent.click(
        await screen.findByRole('button', { name: en.registration.copyTrackingNumber }),
      );
    });
    expect(screen.getByRole('alert').textContent).toBe(en.registration.copyFailed);
  });

  it('Arabic locale uses the Arabic aria-label', async () => {
    renderCard('ar');
    const button = await screen.findByRole('button', { name: ar.registration.copyTrackingNumber });
    expect(button.getAttribute('aria-label')).not.toMatch(/[A-Za-z]/);
  });
});
