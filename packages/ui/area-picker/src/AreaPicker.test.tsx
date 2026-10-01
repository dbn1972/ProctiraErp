import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AreaPicker } from './AreaPicker';
import type { AreaNode } from './types';

const testAreas: AreaNode[] = [
  {
    id: 'country-1',
    name: 'Country A',
    parentId: null,
    level: 0,
    children: [
      {
        id: 'region-1',
        name: 'Region 1',
        parentId: 'country-1',
        level: 1,
        children: [
          { id: 'district-1', name: 'District 1', parentId: 'region-1', level: 2 },
          { id: 'district-2', name: 'District 2', parentId: 'region-1', level: 2 },
        ],
      },
      {
        id: 'region-2',
        name: 'Region 2',
        parentId: 'country-1',
        level: 1,
        children: [],
      },
    ],
  },
];

describe('AreaPicker', () => {
  it('renders trigger button with placeholder', () => {
    render(
      <AreaPicker
        areas={testAreas}
        onSelect={vi.fn()}
        ariaLabel="Select area"
        placeholder="Choose an area"
      />,
    );

    expect(screen.getByRole('button', { name: /select area/i })).toBeInTheDocument();
    expect(screen.getByText('Choose an area')).toBeInTheDocument();
  });

  it('opens dropdown on trigger click', () => {
    render(<AreaPicker areas={testAreas} onSelect={vi.fn()} ariaLabel="Select area" />);

    const trigger = screen.getByRole('button', { name: /select area/i });
    fireEvent.click(trigger);

    expect(screen.getByRole('tree')).toBeInTheDocument();
    expect(screen.getByText('Country A')).toBeInTheDocument();
  });

  it('expands tree nodes on expand button click', () => {
    render(<AreaPicker areas={testAreas} onSelect={vi.fn()} ariaLabel="Select area" />);

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /select area/i }));

    // Expand Country A
    const expandBtn = screen.getByRole('button', { name: /expand country a/i });
    fireEvent.click(expandBtn);

    expect(screen.getByText('Region 1')).toBeInTheDocument();
    expect(screen.getByText('Region 2')).toBeInTheDocument();
  });

  it('calls onSelect when a node is selected', () => {
    const onSelect = vi.fn();
    render(<AreaPicker areas={testAreas} onSelect={onSelect} ariaLabel="Select area" />);

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /select area/i }));

    // Select Country A
    const selectBtn = screen.getByRole('button', { name: /select country a/i });
    fireEvent.click(selectBtn);

    expect(onSelect).toHaveBeenCalledWith(
      ['country-1'],
      [expect.objectContaining({ id: 'country-1', name: 'Country A' })],
    );
  });

  it('shows selected node name in trigger', () => {
    render(
      <AreaPicker
        areas={testAreas}
        selectedIds={['country-1']}
        onSelect={vi.fn()}
        ariaLabel="Select area"
      />,
    );

    expect(screen.getByText('Country A')).toBeInTheDocument();
  });

  it('supports multiple selection', () => {
    const onSelect = vi.fn();
    render(
      <AreaPicker
        areas={testAreas}
        selectedIds={['country-1']}
        onSelect={onSelect}
        multiple
        ariaLabel="Select area"
      />,
    );

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /select area/i }));

    // Expand and select Region 1
    fireEvent.click(screen.getByRole('button', { name: /expand country a/i }));
    fireEvent.click(screen.getByRole('button', { name: /select region 1/i }));

    expect(onSelect).toHaveBeenCalledWith(['country-1', 'region-1'], expect.any(Array));
  });

  it('shows search input when searchable', () => {
    render(<AreaPicker areas={testAreas} onSelect={vi.fn()} ariaLabel="Select area" searchable />);

    fireEvent.click(screen.getByRole('button', { name: /select area/i }));
    expect(screen.getByLabelText(/search areas/i)).toBeInTheDocument();
  });

  it('disables interaction when disabled', () => {
    render(<AreaPicker areas={testAreas} onSelect={vi.fn()} ariaLabel="Select area" disabled />);

    const trigger = screen.getByRole('button', { name: /select area/i });
    expect(trigger).toBeDisabled();
  });

  it('shows loading state', () => {
    render(<AreaPicker areas={testAreas} onSelect={vi.fn()} ariaLabel="Select area" loading />);

    fireEvent.click(screen.getByRole('button', { name: /select area/i }));
    expect(screen.getByText('Loading areas...')).toBeInTheDocument();
  });

  it('has proper WCAG tree role attributes', () => {
    render(<AreaPicker areas={testAreas} onSelect={vi.fn()} ariaLabel="Select area" />);

    const trigger = screen.getByRole('button', { name: /select area/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'tree');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  describe('lazy loading (PRC-L190)', () => {
    const deepFreeze = <T,>(o: T): T => {
      Object.freeze(o);
      for (const v of Object.values(o as object)) {
        if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
      }
      return o;
    };

    it('lets a lazily loaded child be selected without mutating props', async () => {
      const lazyAreas = deepFreeze<AreaNode[]>([
        { id: 'root', name: 'Root', parentId: null, level: 0 },
      ]);
      const child: AreaNode = { id: 'kid', name: 'Lazy Child', parentId: 'root', level: 1 };
      const onLoadChildren = vi.fn().mockResolvedValue([child]);
      const onSelect = vi.fn();
      const { rerender } = render(
        <AreaPicker
          areas={lazyAreas}
          onSelect={onSelect}
          onLoadChildren={onLoadChildren}
          ariaLabel="Select area"
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /select area/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Expand Root' }));
      const selectChild = await screen.findByRole('button', { name: 'Select Lazy Child' });
      expect(onLoadChildren).toHaveBeenCalledWith('root');
      expect(lazyAreas[0]?.children).toBeUndefined();
      fireEvent.click(selectChild);
      expect(onSelect).toHaveBeenCalledWith(['kid'], [child]);
      rerender(
        <AreaPicker
          areas={lazyAreas}
          selectedIds={['kid']}
          onSelect={onSelect}
          onLoadChildren={onLoadChildren}
          ariaLabel="Select area"
        />,
      );
      expect(screen.getByText('Lazy Child')).toBeInTheDocument();
    });
  });

  describe('lazy load errors (PRC-L191)', () => {
    it('shows an alert on rejection, reports it, and retries successfully', async () => {
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      const areas: AreaNode[] = [{ id: 'root', name: 'Root', parentId: null, level: 0 }];
      const onLoadChildren = vi
        .fn()
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce([{ id: 'kid', name: 'Kid', parentId: 'root', level: 1 }]);
      const onLoadError = vi.fn();
      render(
        <AreaPicker
          areas={areas}
          onSelect={vi.fn()}
          onLoadChildren={onLoadChildren}
          onLoadError={onLoadError}
          ariaLabel="Select area"
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /select area/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Expand Root' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Could not load Root.');
      expect(onLoadError).toHaveBeenCalledWith('root', expect.any(Error));
      fireEvent.click(screen.getByRole('button', { name: 'Retry loading Root' }));
      expect(await screen.findByRole('button', { name: 'Select Kid' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await new Promise((r) => setTimeout(r, 0));
      process.off('unhandledRejection', unhandled);
      expect(unhandled).not.toHaveBeenCalled();
    });
  });
});
