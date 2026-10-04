import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouteErrorPanel } from './route-error';

describe('RouteErrorPanel', () => {
  it('does not show the raw error message to the user (PRC-L069)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('SELECT * FROM students WHERE tenant_id = 1'), {
      digest: 'abc123',
    });
    render(<RouteErrorPanel error={error} reset={() => {}} />);
    expect(screen.queryByText(/SELECT/)).not.toBeInTheDocument();
    expect(screen.getByText(/unexpected error occurred/i)).toBeInTheDocument();
    expect(screen.getByTestId('route-error-digest')).toHaveTextContent('Reference: abc123');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('omits the reference line when there is no digest', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<RouteErrorPanel error={new Error('boom')} reset={() => {}} />);
    expect(screen.queryByTestId('route-error-digest')).not.toBeInTheDocument();
    expect(screen.queryByText('boom')).not.toBeInTheDocument();
  });
});
