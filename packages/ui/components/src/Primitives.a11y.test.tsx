import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';

import { Alert, AlertDescription } from './Alert';
import { Checkbox } from './Checkbox';
import { Table, TableBody, TableCell, TableRow } from './Table';

/** PRC-L197 — Alert politeness, Checkbox target size, focusable Table scroll region. */
describe('PRC-L197 primitives a11y', () => {
  it('Alert uses role=status for non-destructive variants and role=alert for destructive', () => {
    const { rerender } = render(<Alert>Saved</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    rerender(<Alert variant="success">Saved</Alert>);
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(<Alert variant="warning">Careful</Alert>);
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(<Alert variant="destructive">Failed</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
    rerender(
      <Alert variant="warning" role="alert">
        Override
      </Alert>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Override');
  });

  it('Checkbox has a 24px hit area via an inset pseudo-element', () => {
    render(<Checkbox aria-label="Accept terms" />);
    const box = screen.getByRole('checkbox', { name: 'Accept terms' });
    // 16px box + 4px on each side (after:-inset-1) = 24px target
    expect(box.className).toContain('h-4 w-4');
    expect(box.className).toContain('relative');
    expect(box.className).toContain('after:absolute');
    expect(box.className).toContain('after:-inset-1');
  });

  it('Table scroll wrapper is keyboard focusable and named', async () => {
    const { container } = render(
      <Table aria-label="Fee ledger">
        <TableBody>
          <TableRow>
            <TableCell>Term 1</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const region = screen.getByRole('region', { name: 'Fee ledger' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region.querySelector('table')).not.toBeNull();
    const results = await axe(container, {
      rules: { 'scrollable-region-focusable': { enabled: true } },
    });
    expect(results).toHaveNoViolations();
  });

  it('Table accepts an explicit scroll region label', () => {
    render(
      <Table scrollRegionLabel="Scrollable timetable">
        <TableBody>
          <TableRow>
            <TableCell>Mon</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole('region', { name: 'Scrollable timetable' })).toBeInTheDocument();
  });

  it('Alert and Checkbox have no axe violations', async () => {
    const { container } = render(
      <div>
        <Alert variant="success">
          <AlertDescription>Saved</AlertDescription>
        </Alert>
        <Checkbox aria-label="Accept terms" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
