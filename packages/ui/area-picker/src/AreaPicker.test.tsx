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
      />
    );

    expect(screen.getByRole('button', { name: /select area/i })).toBeInTheDocument();
    expect(screen.getByText('Choose an area')).toBeInTheDocument();
  });

  it('opens dropdown on trigger click', () => {
    render(
      <AreaPicker areas={testAreas} onSelect={vi.fn()} ariaLabel="Select area" />
    );

    const trigger = screen.getByRole('button', { name: /select area/i });
    fireEvent.click(trigger);

    expect(screen.getByRole('tree')).toBeInTheDocument();
    expect(screen.getByText('Country A')).toBeInTheDocument();
  });

  it('expands tree nodes on expand button click', () => {
    render(
      <AreaPicker areas={testAreas} onSelect={vi.fn()} ariaLabel="Select area" />
    );

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
    render(
      <AreaPicker areas={testAreas} onSelect={onSelect} ariaLabel="Select area" />
    );

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /select area/i }));

    // Select Country A
    const selectBtn = screen.getByRole('button', { name: /select country a/i });
    fireEvent.click(selectBtn);

    expect(onSelect).toHaveBeenCalledWith(
      ['country-1'],
      [expect.objectContaining({ id: 'country-1', name: 'Country A' })]
    );
  });

  it('shows selected node name in trigger', () => {
    render(
      <AreaPicker
        areas={testAreas}
        selectedIds={['country-1']}
        onSelect={vi.fn()}
        ariaLabel="Select area"
      />
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
      />
    );

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /select area/i }));

    // Expand and select Region 1
    fireEvent.click(screen.getByRole('button', { name: /expand country a/i }));
    fireEvent.click(screen.getByRole('button', { name: /select region 1/i }));

    expect(onSelect).toHaveBeenCalledWith(
      ['country-1', 'region-1'],
      expect.any(Array)
    );
  });

  it('shows search input when searchable', () => {
    render(
      <AreaPicker
        areas={testAreas}
        onSelect={vi.fn()}
        ariaLabel="Select area"
        searchable
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /select area/i }));
    expect(screen.getByLabelText(/search areas/i)).toBeInTheDocument();
  });

  it('disables interaction when disabled', () => {
    render(
      <AreaPicker
        areas={testAreas}
        onSelect={vi.fn()}
        ariaLabel="Select area"
        disabled
      />
    );

    const trigger = screen.getByRole('button', { name: /select area/i });
    expect(trigger).toBeDisabled();
  });

  it('shows loading state', () => {
    render(
      <AreaPicker
        areas={testAreas}
        onSelect={vi.fn()}
        ariaLabel="Select area"
        loading
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /select area/i }));
    expect(screen.getByText('Loading areas...')).toBeInTheDocument();
  });

  it('has proper WCAG tree role attributes', () => {
    render(
      <AreaPicker areas={testAreas} onSelect={vi.fn()} ariaLabel="Select area" />
    );

    const trigger = screen.getByRole('button', { name: /select area/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'tree');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});
