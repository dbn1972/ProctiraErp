/**
 * @vitest-environment jsdom
 *
 * PRC-H115: connection strings are masked inputs, stored credentials are
 * never reloaded into the form, and a blank field on edit keeps the saved
 * secret (the redaction placeholder is echoed so the API restores it).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';


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

  it('does not reload stored credentials and echoes the placeholder for blank secrets', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') return {};
      return {
        id: 'p1',
        name: 'Nightly sync',
        // API shape: secrets come back as the redaction placeholder.
        source: {
          type: 'postgresql',
          host: 'db.internal',
          port: 5432,
          database: 'src',
          username: 'etl',
          password: '__REDACTED__',
          query: 'SELECT 1',
        },
        destination: {
          type: 'postgresql',
          host: 'dw.internal',
          port: 5432,
          database: 'dw',
          username: 'loader',
          password: '__REDACTED__',
          table: 't',
        },
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
    expect(container.innerHTML).not.toContain('__REDACTED__');
    expect(container.innerHTML).toContain('etl@db.internal:5432/src');

    fireEvent.submit(source.closest('form')!);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/etl/pipelines/p1', expect.anything()),
    );
    const putCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')!;
    const json = putCall[1].json as {
      source: Record<string, unknown>;
      destination: Record<string, unknown>;
    };
    // Saved target unchanged + placeholder password → the API restores the secret.
    expect(json.source).toMatchObject({
      type: 'postgresql',
      host: 'db.internal',
      port: 5432,
      database: 'src',
      username: 'etl',
      password: '__REDACTED__',
      query: 'SELECT 1',
    });
    expect(json.source).not.toHaveProperty('connectionString');
    expect(json.destination).toMatchObject({ host: 'dw.internal', password: '__REDACTED__' });
  });

  it('omits a blank credential on update when nothing was stored', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') return {};
      return {
        id: 'p2',
        name: 'CSV import',
        source: { type: 'csv', query: '' },
        destination: {
          type: 'postgresql',
          host: 'dw.internal',
          port: 5432,
          database: 'dw',
          username: 'loader',
          password: '__REDACTED__',
          table: 't',
        },
        fieldMappings: [],
        schedule: null,
        retryPolicy: { maxRetries: 3, backoffMs: 1000 },
      };
    });
    renderAt('/pipelines/p2/edit');
    await waitFor(() =>
      expect((screen.getByLabelText(/pipeline name/i) as HTMLInputElement).value).toBe(
        'CSV import',
      ),
    );
    fireEvent.submit(screen.getByLabelText('Source connection string').closest('form')!);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/etl/pipelines/p2', expect.anything()),
    );
    const putCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')!;
    const json = putCall[1].json as {
      source: Record<string, unknown>;
      destination: Record<string, unknown>;
    };
    expect(json.source).not.toHaveProperty('connectionString');
    expect(json.source).not.toHaveProperty('password');
    expect(json.destination.password).toBe('__REDACTED__');
  });

  it('parses a new PostgreSQL URL into the API host/password schema', async () => {
    fetchMock.mockResolvedValue({});
    renderAt('/pipelines/new');
    fireEvent.change(screen.getByLabelText(/pipeline name/i), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText('Source connection string'), {
      target: { value: 'postgresql://etl:s3cr%40t@db.internal:6543/src' },
    });
    fireEvent.change(screen.getByLabelText('Destination connection string'), {
      target: { value: 'postgresql://loader:pw@dw.internal/dw' },
    });
    fireEvent.submit(screen.getByLabelText('Source connection string').closest('form')!);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/etl/pipelines', expect.anything()),
    );
    const json = fetchMock.mock.calls[0]![1].json as {
      source: Record<string, unknown>;
      destination: Record<string, unknown>;
    };
    expect(json.source).toMatchObject({
      type: 'postgresql',
      host: 'db.internal',
      port: 6543,
      database: 'src',
      username: 'etl',
      password: 's3cr@t',
    });
    expect(json.destination).toMatchObject({ host: 'dw.internal', port: 5432, password: 'pw' });
  });
});
