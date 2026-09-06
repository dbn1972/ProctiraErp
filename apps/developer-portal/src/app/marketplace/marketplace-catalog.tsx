'use client';

import { useMemo, useState } from 'react';

import { MARKETPLACE_CATALOG, type MarketplacePlugin } from '@/lib/marketplace-catalog';

const CATEGORIES = ['all', 'attendance', 'reporting', 'identity', 'communications'] as const;

export function MarketplaceCatalog() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MARKETPLACE_CATALOG.filter((plugin) => {
      const categoryOk = category === 'all' || plugin.category === category;
      if (!categoryOk) return false;
      if (!q) return true;
      return (
        plugin.name.toLowerCase().includes(q) ||
        plugin.vendor.toLowerCase().includes(q) ||
        plugin.summary.toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  return (
    <div data-testid="marketplace-catalog">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search plugins"
          aria-label="Search plugins"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm sm:max-w-sm"
          data-testid="marketplace-search"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
          aria-label="Filter by category"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          data-testid="marketplace-category"
        >
          {CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2" data-testid="marketplace-list">
        {filtered.map((plugin) => (
          <PluginCard key={plugin.id} plugin={plugin} />
        ))}
      </ul>

      {filtered.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600" data-testid="marketplace-empty">
          No plugins match this filter.
        </p>
      ) : null}
    </div>
  );
}

function PluginCard({ plugin }: { plugin: MarketplacePlugin }) {
  return (
    <li
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
      data-testid={`marketplace-plugin-${plugin.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-gray-900">{plugin.name}</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium uppercase text-gray-700">
          {plugin.status}
        </span>
      </div>
      <p className="mt-1 text-xs font-medium text-primary-700">{plugin.vendor}</p>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">{plugin.summary}</p>
      <p className="mt-3 text-xs text-gray-500">Category: {plugin.category}</p>
      <button
        type="button"
        className="mt-4 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700"
        disabled
        title="Install requires a connected marketplace service"
        data-testid={`marketplace-install-${plugin.id}`}
      >
        Install (not connected)
      </button>
    </li>
  );
}
