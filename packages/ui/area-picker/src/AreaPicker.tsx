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
  ariaLabel,
  className = '',
  searchable = false,
}: AreaPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Build a flat map for quick lookups
  const nodeMap = useMemo(() => {
    const map = new Map<string, AreaNode>();
    const traverse = (nodes: AreaNode[]) => {
      for (const node of nodes) {
        map.set(node.id, node);
        if (node.children) traverse(node.children);
      }
    };
    traverse(areas);
    return map;
  }, [areas]);

  // Filter nodes by search query
  const matchesSearch = useCallback(
    (node: AreaNode): boolean => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      if (node.name.toLowerCase().includes(query)) return true;
      if (node.children) return node.children.some(matchesSearch);
      return false;
    },
    [searchQuery],
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
        if (onLoadChildren && node && (!node.children || node.children.length === 0)) {
          setLoadingNodes((prev) => new Set(prev).add(nodeId));
          try {
            const children = await onLoadChildren(nodeId);
            node.children = children;
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
    [expandedIds, nodeMap, onLoadChildren],
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
        .map((id) => nodeMap.get(id))
        .filter((n): n is AreaNode => n !== undefined);

      onSelect(newSelectedIds, selectedNodes);
    },
    [multiple, selectedIds, nodeMap, onSelect],
  );

  const getSelectedLabel = (): string => {
    if (selectedIds.length === 0) return placeholder;
    if (selectedIds.length === 1) {
      const firstId = selectedIds[0];
      if (firstId) {
        const node = nodeMap.get(firstId);
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
    const hasChildren = (node.children && node.children.length > 0) || !!onLoadChildren;
    const isLoading = loadingNodes.has(node.id);
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
              onClick={() => toggleExpand(node.id)}
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
        {hasChildren && isExpanded && node.children && (
          <ul role="group" className="proctira-area-picker__children">
            {node.children.map((child) => renderNode(child, depth + 1))}
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
