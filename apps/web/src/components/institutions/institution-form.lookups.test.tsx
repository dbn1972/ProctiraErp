import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/institutions/new',
}));

import { InstitutionForm } from './institution-form';

describe('InstitutionForm lookup failure (PRC-M155)', () => {
  it('shows an error and disables submit when areas failed to load', () => {
    render(
      <InstitutionForm
        areas={[]}
        types={[]}
        sectors={[]}
        ownerships={[]}
        lookupErrors={['areas']}
      />,
    );
    expect(screen.getByTestId('institution-lookup-error')).toHaveTextContent(
      'Could not load areas',
    );
    expect(screen.getByRole('button', { name: 'Create institution' })).toBeDisabled();
  });
});
