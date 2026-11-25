/**
 * PRC-L226 — third-party map tiles/markers load only after the visitor asks
 * for the map; the document upload label is bound to its file input; the
 * tracking timeline states each step in text (not only icon/colour).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ getInstitutions: vi.fn() }));
// The real MapView is the only component that creates the Leaflet tile layer.
vi.mock('next/dynamic', () => ({
  default: () =>
    function MapViewStub() {
      return <div data-testid="map-view" />;
    },
}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values?.label ? `${key}:${values.label}` : key,
}));
vi.mock('./registration/registration-context', () => ({
  useRegistration: () => ({
    draft: { documents: [] },
    addDocument: vi.fn(),
    removeDocument: vi.fn(),
  }),
}));

const { InstitutionMap } = await import('./institutions/institution-map');
const { DocumentUpload } = await import('./registration/document-upload');
const { StatusCard } = await import('./tracking/status-card');

afterEach(() => cleanup());

describe('PRC-L226 map loads only on explicit action', () => {
  it('shows the privacy note and no map until "show map" is pressed', async () => {
    render(<InstitutionMap initialInstitutions={[]} initialTotal={0} />);
    expect(screen.queryByTestId('map-view')).toBeNull();
    expect(screen.getByText('mapPrivacyNote')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /showMap/ }));
    });
    expect(screen.getByTestId('map-view')).toBeTruthy();
  });
});

describe('PRC-L226 document upload label binding', () => {
  it('the visible label names the file input', () => {
    const { container } = render(
      <DocumentUpload documentType="birth_certificate" label="Birth certificate" required />,
    );
    const input = container.querySelector('input[type="file"]');
    const label = container.querySelector('label');
    expect(input?.id).toBeTruthy();
    expect(label?.getAttribute('for')).toBe(input?.id);
  });
});

describe('PRC-L226 timeline step state in text', () => {
  it('each step carries a text state and the current step is marked', () => {
    const { container } = render(
      <StatusCard
        status={{
          trackingNumber: 'REG-1',
          status: 'under_review',
          institutionName: 'School',
          applicantName: 'A.',
          submittedAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
        }}
      />,
    );
    const steps = [...container.querySelectorAll('ol > li')];
    expect(steps.map((li) => li.querySelector('.sr-only')?.textContent)).toEqual([
      ': stepDone',
      ': stepDone',
      ': stepActive',
    ]);
    expect(steps.map((li) => li.getAttribute('aria-current'))).toEqual([null, null, 'step']);
  });
});
