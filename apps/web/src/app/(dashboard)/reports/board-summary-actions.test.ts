/** PRC-M110 — board summary goes through the gateway with a validated id. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayFetch } = vi.hoisted(() => ({ gatewayFetch: vi.fn() }));
vi.mock('@/lib/api/gateway', () => ({ gatewayFetch }));

import { getBoardSummaryAction } from './board-summary-actions';

const BOARD = '01890a5d-ac96-774b-bcce-b302099a8058';

describe('getBoardSummaryAction (PRC-M110)', () => {
  beforeEach(() => gatewayFetch.mockReset());

  it('rejects a non-UUID id without calling the gateway', async () => {
    expect(await getBoardSummaryAction('../../tenants')).toMatchObject({ status: 'error' });
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('returns the gateway summary', async () => {
    gatewayFetch.mockResolvedValue({ ok: true, status: 200, data: { boardId: BOARD, schools: 3 } });
    const result = await getBoardSummaryAction(BOARD);
    expect(gatewayFetch.mock.calls[0]![0]).toBe(`/reports/board/${BOARD}/summary`);
    expect(result).toMatchObject({ status: 'success', summary: { schools: 3 } });
  });

  it('maps 403 to a permission message', async () => {
    gatewayFetch.mockResolvedValue({ ok: false, status: 403, error: { message: 'x' } });
    expect(await getBoardSummaryAction(BOARD)).toEqual({
      status: 'error',
      message: 'Your role cannot view this board summary.',
    });
  });

  it('no client fetch to /api/v1/* remains in reports components', () => {
    const src = readFileSync(
      path.join(__dirname, '_components', 'board-summary-panel.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/fetch\(\s*[`'"]\/api\/v1/);
  });
});
