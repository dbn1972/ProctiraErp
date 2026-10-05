import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { LookupLoadError } from './lookup-load-error';

describe('LookupLoadError', () => {
  it('renders nothing when no lookup failed', () => {
    const { container } = render(<LookupLoadError failed={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an alert naming the failed lookups with a retry', () => {
    render(<LookupLoadError failed={['institutions']} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load institutions');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalled();
  });
});
