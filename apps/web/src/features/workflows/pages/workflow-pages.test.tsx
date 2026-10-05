/**
 * PRC-L077: workflow inbox paging stays numeric; transitions post the signed-in
 * actor (never a hard-coded id) and surface gateway errors.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.mock('@/lib/api/browser-gateway', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/browser-gateway')>(
    '@/lib/api/browser-gateway',
  );
  return { ...actual, browserGatewayFetch: (...args: unknown[]) => fetchMock(...args) };
});
let authUser: { id: string } | null = { id: 'user-42' };
vi.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: authUser }) }));

import { BrowserGatewayError } from '@/lib/api/browser-gateway';
import WorkflowDetail from './WorkflowDetail';
import WorkflowInbox from './WorkflowInbox';

const instance = {
  id: 'inst-1',
  workflowDefinitionId: 'def-1',
  entityType: 'leave_request',
  entityId: 'lr-1',
  currentStateId: 's1',
  status: 'ACTIVE',
  metadata: null,
  approvals: [],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};
const definition = {
  id: 'def-1',
  tenantId: 't',
  name: 'Leave',
  states: [
    { id: 's1', name: 'Pending', type: 'INITIAL' },
    { id: 's2', name: 'Approved', type: 'FINAL' },
  ],
  transitions: [{ id: 't1', fromStateId: 's1', toStateId: 's2', action: 'approve' }],
  escalationRules: null,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

function routeDetail(path: string) {
  if (path === '/workflows/instances/inst-1') return Promise.resolve(instance);
  if (path === '/workflows/def-1') return Promise.resolve(definition);
  if (path === '/workflows/instances/inst-1/audit') return Promise.resolve({ data: [] });
  return Promise.reject(new Error(`unexpected ${path}`));
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/workflows/inst-1']}>
      <Routes>
        <Route path="/workflows/:instanceId" element={<WorkflowDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  authUser = { id: 'user-42' };
});

describe('WorkflowDetail transitions', () => {
  it('posts the signed-in user as actorId after confirmation', async () => {
    fetchMock.mockImplementation((path: string, init?: { method?: string }) =>
      init?.method === 'POST'
        ? Promise.resolve({ ...instance, currentStateId: 's2' })
        : routeDetail(path),
    );
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: /Approve — transition/ }));
    const confirm = await screen.findAllByRole('button', { name: 'Approve' });
    fireEvent.click(confirm[confirm.length - 1]!);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/workflows/instances/inst-1/transition', {
        method: 'POST',
        json: { action: 'approve', actorId: 'user-42', comments: undefined },
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('current-user');
  });

  it('disables transitions without a signed-in actor', async () => {
    authUser = null;
    fetchMock.mockImplementation(routeDetail);
    renderDetail();
    expect(await screen.findByRole('button', { name: /Approve — transition/ })).toBeDisabled();
  });

  it('shows the gateway error when a transition fails', async () => {
    fetchMock.mockImplementation((path: string, init?: { method?: string }) =>
      init?.method === 'POST'
        ? Promise.reject(
            new BrowserGatewayError({ status: 409, code: 'CONFLICT', message: 'Already approved' }),
          )
        : routeDetail(path),
    );
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: /Approve — transition/ }));
    const confirm = await screen.findAllByRole('button', { name: 'Approve' });
    fireEvent.click(confirm[confirm.length - 1]!);
    expect(await screen.findByText('Already approved')).toBeInTheDocument();
  });
});

describe('WorkflowInbox pagination', () => {
  it('requests numeric pages forward and back', async () => {
    fetchMock.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 20, total: 60, totalPages: 3 },
    });
    render(<WorkflowInbox />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    });
    const pages = fetchMock.mock.calls.map((c) =>
      new URLSearchParams(String(c[0]).split('?')[1]).get('page'),
    );
    expect(pages).toEqual(['1', '2', '3', '2']);
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('shows an error state when the inbox fails to load', async () => {
    fetchMock.mockRejectedValue(
      new BrowserGatewayError({ status: 500, code: 'BOOM', message: 'Inbox unavailable' }),
    );
    render(<WorkflowInbox />);
    expect(await screen.findByText('Inbox unavailable')).toBeInTheDocument();
  });
  it('asks the server for my assigned instances with priority filter (PRC-M491)', async () => {
    fetchMock.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 },
    });
    render(<WorkflowInbox />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const first = new URLSearchParams(String(fetchMock.mock.calls[0]![0]).split('?')[1]);
    expect(first.get('mine')).toBe('true');
    const prioritySelect = screen
      .getAllByRole('combobox')
      .find((el) => Array.from((el as HTMLSelectElement).options).some((o) => o.value === 'high'))!;
    await act(async () => {
      fireEvent.change(prioritySelect, { target: { value: 'high' } });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const second = new URLSearchParams(String(fetchMock.mock.calls[1]![0]).split('?')[1]);
    expect(second.get('priority')).toBe('high');
    expect(second.get('page')).toBe('1');
  });
});
