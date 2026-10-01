'use client';

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';

import type { AreaPickerProps, AreaNode } from './types';

/**
 * AreaPicker component for hierarchical tree selection of geographic/administrative areas.
 * Supports lazy loading, search, and multi-select. Meets WCAG 2.1 Level AA.
 *
 * @example
 * ```tsx
 * <AreaPicker
 *   areas={areaTree}
 *   onSelect={(ids, nodes) => setSelectedAreas(ids)}
 *   ariaLabel="Select administrative area"
 *   searchable
 * />
 * ```
 */
export function AreaPicker({
  areas,
  selectedIds = [],
  onSelect,
  multiple = false,
  maxDepth,
  placeholder = 'Select area...',
  disabled = false,
  loading = false,
  onLoadChildren,
  onLoadError,
  ariaLabel,
  className = '',
  searchable = false,
}: AreaPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  // Lazily loaded children are kept in state (keyed by parent id) instead of
  // mutating the caller's `areas` prop, so they are reflected in nodeMap and render.
  const [loadedChildren, setLoadedChildren] = useState<Map<string, AreaNode[]>>(new Map());
  const [loadErrors, setLoadErrors] = useState<Map<string, string>>(new Map());
  // Cache of every node ever seen, so selected labels survive collapse/refetch.
  const selectedCacheRef = useRef<Map<string, AreaNode>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const getChildren = useCallback(
    (node: AreaNode): AreaNode[] | undefined => loadedChildren.get(node.id) ?? node.children,
    [loadedChildren],
  );

  // Build a flat map for quick lookups (static tree + lazily loaded children)
  const nodeMap = useMemo(() => {
    const map = new Map<string, AreaNode>();
    const traverse = (nodes: AreaNode[]) => {
      for (const node of nodes) {
        map.set(node.id, node);
        selectedCacheRef.current.set(node.id, node);
        const children = getChildren(node);
        if (children) traverse(children);
      }
    };
    traverse(areas);
    return map;
  }, [areas, getChildren]);

  const lookupNode = useCallback(
    (id: string): AreaNode | undefined => nodeMap.get(id) ?? selectedCacheRef.current.get(id),
    [nodeMap],
  );

  // Filter nodes by search query
  const matchesSearch = useCallback(
    (node: AreaNode): boolean => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      if (node.name.toLowerCase().includes(query)) return true;
      const children = getChildren(node);
      if (children) return children.some(matchesSearch);
      return false;
    },
    [searchQuery, getChildren],
  );

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const toggleExpand = useCallback(
    async (nodeId: string) => {
      const newExpanded = new Set(expandedIds);
      if (newExpanded.has(nodeId)) {
        newExpanded.delete(nodeId);
      } else {
        newExpanded.add(nodeId);
        // Lazy load children if handler provided
        const node = nodeMap.get(nodeId);
        const existing = node ? getChildren(node) : undefined;
        if (onLoadChildren && node && (!existing || existing.length === 0)) {
          setLoadingNodes((prev) => new Set(prev).add(nodeId));
          setLoadErrors((prev) => {
            if (!prev.has(nodeId)) return prev;
            const next = new Map(prev);
            next.delete(nodeId);
            return next;
          });
          try {
            const children = await onLoadChildren(nodeId);
            setLoadedChildren((prev) => new Map(prev).set(nodeId, children));
          } catch (error) {
            // Surface the failure in-tree (role=alert + retry) instead of an
            // unhandled rejection; keep the node collapsed so retry re-fetches.
            setLoadErrors((prev) => new Map(prev).set(nodeId, `Could not load ${node.name}.`));
            onLoadError?.(nodeId, error);
            return;
          } finally {
            setLoadingNodes((prev) => {
              const next = new Set(prev);
              next.delete(nodeId);
              return next;
            });
          }
        }
      }
      setExpandedIds(newExpanded);
    },
    [expandedIds, nodeMap, onLoadChildren, onLoadError, getChildren],
  );

  const handleSelect = useCallback(
    (node: AreaNode) => {
      if (node.selectable === false) return;

      let newSelectedIds: string[];
      if (multiple) {
        newSelectedIds = selectedIds.includes(node.id)
          ? selectedIds.filter((id) => id !== node.id)
          : [...selectedIds, node.id];
      } else {
        newSelectedIds = [node.id];
        setIsOpen(false);
      }

      const selectedNodes = newSelectedIds
        .map((id) => lookupNode(id))
        .filter((n): n is AreaNode => n !== undefined);

      onSelect(newSelectedIds, selectedNodes);
    },
    [multiple, selectedIds, lookupNode, onSelect],
  );

  const getSelectedLabel = (): string => {
    if (selectedIds.length === 0) return placeholder;
    if (selectedIds.length === 1) {
      const firstId = selectedIds[0];
      if (firstId) {
        const node = lookupNode(firstId);
        return node?.name ?? placeholder;
      }
      return placeholder;
    }
    return `${selectedIds.length} areas selected`;
  };

  const renderNode = (node: AreaNode, depth: number = 0): React.ReactNode => {
    if (maxDepth !== undefined && depth > maxDepth) return null;
    if (!matchesSearch(node)) return null;

    const isExpanded = expandedIds.has(node.id);
    const isSelected = selectedIds.includes(node.id);
    const children = getChildren(node);
    const hasChildren = (children && children.length > 0) || !!onLoadChildren;
    const isLoading = loadingNodes.has(node.id);
    const loadError = loadErrors.get(node.id);
    const isSelectable = node.selectable !== false;

    return (
      <li
        key={node.id}
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isSelected}
        aria-level={depth + 1}
        className="proctira-area-picker__node"
      >
        <div
          className={`proctira-area-picker__node-content ${isSelected ? 'proctira-area-picker__node-content--selected' : ''}`}
          style={{ paddingLeft: `${depth * 1.5}rem` }}
        >
          {hasChildren && (
            <button
              type="button"
              onClick={() => void toggleExpand(node.id)}
              className="proctira-area-picker__expand-btn"
              aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
              disabled={disabled}
            >
              {isLoading ? (
                <span className="proctira-area-picker__spinner" aria-hidden="true">
                  ⟳
                </span>
              ) : (
                <span aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
              )}
            </button>
          )}
          {!hasChildren && <span className="proctira-area-picker__spacer" aria-hidden="true" />}
          <button
            type="button"
            onClick={() => handleSelect(node)}
            className={`proctira-area-picker__select-btn ${!isSelectable ? 'proctira-area-picker__select-btn--disabled' : ''}`}
            disabled={disabled || !isSelectable}
            aria-label={`${isSelected ? 'Deselect' : 'Select'} ${node.name}`}
          >
            {multiple && (
              <span
                className={`proctira-area-picker__checkbox ${isSelected ? 'proctira-area-picker__checkbox--checked' : ''}`}
                aria-hidden="true"
              >
                {isSelected ? '☑' : '☐'}
              </span>
            )}
            <span className="proctira-area-picker__node-name">{node.name}</span>
          </button>
        </div>
        {loadError && (
          <div
            role="alert"
            className="proctira-area-picker__load-error"
            style={{ paddingLeft: `${(depth + 1) * 1.5}rem` }}
          >
            <span>{loadError}</span>{' '}
            <button
              type="button"
              onClick={() => void toggleExpand(node.id)}
              className="proctira-area-picker__retry-btn"
              aria-label={`Retry loading ${node.name}`}
              disabled={disabled}
            >
              Retry
            </button>
          </div>
        )}

        {hasChildren && isExpanded && children && (
          <ul role="group" className="proctira-area-picker__children">
            {children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div ref={containerRef} className={`proctira-area-picker ${className}`} aria-label={ariaLabel}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className="proctira-area-picker__trigger"
        aria-haspopup="tree"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <span className="proctira-area-picker__value">{getSelectedLabel()}</span>
        <span className="proctira-area-picker__arrow" aria-hidden="true">
          {isOpen ? '▴' : '▾'}
        </span>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="proctira-area-picker__dropdown" role="presentation">
          {searchable && (
            <div className="proctira-area-picker__search">
              <label htmlFor="area-picker-search" className="sr-only">
                Search areas
              </label>
              <input
                ref={searchInputRef}
                id="area-picker-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search areas..."
                className="proctira-area-picker__search-input"
                aria-label="Search areas"
              />
            </div>
          )}
          {loading ? (
            <div className="proctira-area-picker__loading" aria-live="polite">
              Loading areas...
            </div>
          ) : (
            <ul role="tree" className="proctira-area-picker__tree" aria-label={ariaLabel}>
              {areas.map((node) => renderNode(node, 0))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
