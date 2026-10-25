/**
 * PRC-L263 — render tests for the Reports catalogue page (async Server Component).
 *
 * Asserts current behaviour only: heading and counts, module grouping, the
 * empty state, the scaffold/honesty banner, and that a failed boards read hands
 * the board-summary panel no options instead of failing the page.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listReportTemplates = vi.fn();
const listGradebookBoards = vi.fn();

vi.mock('@/lib/api/reports', () => ({
  listReportTemplates: (...a: unknown[]) => listReportTemplates(...a),
}));
vi.mock('@/lib/api/gradebook', () => ({
  listGradebookBoards: (...a: unknown[]) => listGradebookBoards(...a),
}));
// Client panels; their own tests cover them.
vi.mock('./_components/board-summary-panel', () => ({
  BoardSummaryPanel: ({ boardOptions }: { boardOptions: Array<{ id: string; label: string }> }) => (
    <ul data-testid="board-summary-stub">
      {boardOptions.map((o) => (
        <li key={o.id}>{o.label}</li>
      ))}
    </ul>
  ),
}));
vi.mock('./_components/catalogue-generate-panel', () => ({
  CatalogueGeneratePanel: () => <div data-testid="catalogue-generate-stub" />,
}));

import ReportsPage from './page';

function template(id: string, name: string, module: string) {
  return { id, name, description: `${name} description`, module, format: ['PDF'], filters: [] };
}

beforeEach(() => {
  listReportTemplates.mockReset();
  listGradebookBoards.mockReset();
  listGradebookBoards.mockResolvedValue({
    ok: true,
    data: [{ id: 'b1', tenantId: 't', code: 'CBSE', name: 'Central Board' }],
  });
});

describe('ReportsPage (PRC-L263)', () => {
  it('lists templates grouped by module with counts', async () => {
    listReportTemplates.mockResolvedValue({
      source: 'gateway',
      templates: [
        template('r1', 'Daily attendance', 'Attendance'),
        template('r2', 'Absentee list', 'Attendance'),
        template('r3', 'Fee dues', 'Fees'),
      ],
    });
    render(await ReportsPage());

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Reports');
    expect(screen.getByText(/3 ready-made reports across 2 modules/)).toBeInTheDocument();

    const attendance = screen.getByRole('region', { name: 'Attendance' });
    expect(within(attendance).getByRole('link', { name: 'Daily attendance' })).toHaveAttribute(
      'href',
      '/reports/r1/results',
    );
    expect(within(attendance).getAllByRole('heading', { level: 3 })).toHaveLength(2);
    expect(within(screen.getByRole('region', { name: 'Fees' })).getByText('Fee dues')).toBeTruthy();

    // Live gateway source: no honesty banner.
    expect(screen.queryByTestId('scaffold-mode-banner')).toBeNull();
    expect(screen.getByTestId('catalogue-generate-stub')).toBeInTheDocument();
    expect(within(screen.getByTestId('board-summary-stub')).getAllByRole('listitem')).toHaveLength(
      1,
    );
  });

  it('shows the empty state and the scaffold banner when no templates load', async () => {
    listReportTemplates.mockResolvedValue({ source: 'scaffold', templates: [] });
    render(await ReportsPage());

    expect(screen.getByText('No report templates')).toBeInTheDocument();
    expect(screen.getByTestId('scaffold-mode-banner')).toHaveAttribute('data-mode', 'scaffold');
    expect(screen.queryByTestId('catalogue-generate-stub')).toBeNull();
    expect(screen.getByText(/0 ready-made reports/)).toBeInTheDocument();
  });

  it('hands the board summary panel no options when the boards read fails', async () => {
    listReportTemplates.mockResolvedValue({ source: 'gateway', templates: [] });
    listGradebookBoards.mockResolvedValue({ ok: false, error: 'unavailable' });
    render(await ReportsPage());

    expect(within(screen.getByTestId('board-summary-stub')).queryAllByRole('listitem')).toEqual([]);
  });
});
