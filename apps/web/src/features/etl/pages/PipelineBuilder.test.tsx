/**
 * @vitest-environment jsdom
 *
 * PRC-H115: connection strings are masked inputs, stored credentials are
 * never reloaded into the form, and a blank field on edit keeps the saved
 * secret (it is omitted from the PUT body).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const STORED_SECRET = 'postgresql://etl:stored-secret@db.internal:5432/src';

const fetchMock = vi.fn();
vi.mock('@/lib/api/browser-gateway', () => ({
  browserGatewayFetch: (...args: unknown[]) => fetchMock(...args),
  BrowserGatewayError: class BrowserGatewayError extends Error {},
}));

import PipelineBuilder from './PipelineBuilder';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/pipelines/new" element={<PipelineBuilder />} />
        <Route path="/pipelines/:pipelineId/edit" element={<PipelineBuilder />} />
        <Route path="*" element={<div>elsewhere</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PRC-H115 — PipelineBuilder credential handling', () => {
  beforeEach(() => {
    cleanup();
    fetchMock.mockReset();
  });

  it('renders connection strings as masked password inputs', () => {
    renderAt('/pipelines/new');
    for (const label of ['Source connection string', 'Destination connection string']) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.type).toBe('password');
      expect(input.getAttribute('autocomplete')).toBe('new-password');
      expect(input.required).toBe(true);
    }
  });

  it('does not reload stored credentials and omits blank secrets on update', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') return {};
      return {
        id: 'p1',
        name: 'Nightly sync',
        source: { type: 'postgresql', connectionString: STORED_SECRET, query: 'SELECT 1' },
        destination: { type: 'postgresql', connectionString: STORED_SECRET, table: 't' },
        fieldMappings: [],
        schedule: null,
        retryPolicy: { maxRetries: 3, backoffMs: 1000 },
      };
    });

    const { container } = renderAt('/pipelines/p1/edit');
    await waitFor(() =>
      expect((screen.getByLabelText(/pipeline name/i) as HTMLInputElement).value).toBe(
        'Nightly sync',
      ),
    );

    const source = screen.getByLabelText('Source connection string') as HTMLInputElement;
    expect(source.type).toBe('password');
    expect(source.value).toBe('');
    expect(source.required).toBe(false);
    expect(source.getAttribute('aria-describedby')).toBe('etl-source-connection-hint');
    expect(container.innerHTML).not.toContain('stored-secret');

    fireEvent.submit(source.closest('form')!);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/etl/pipelines/p1', expect.anything()),
    );
    const putCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')!;
    const json = putCall[1].json as {
      source: Record<string, unknown>;
      destination: Record<string, unknown>;
    };
    expect(json.source).not.toHaveProperty('connectionString');
    expect(json.destination).not.toHaveProperty('connectionString');
    expect(JSON.stringify(json)).not.toContain('stored-secret');
  });
});
