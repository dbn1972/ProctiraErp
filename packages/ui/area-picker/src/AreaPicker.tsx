'use client';

import React, { useState, useCallback, useMemo, useRef, useEffect, useId } from 'react';

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
  // PRC-M454: APG tree keyboard model. The trigger regains focus on close, the
  // tree exposes a single tab stop (roving tabindex), and the currently
  // focused treeitem is tracked by id so Arrow/Home/End can move between the
  // flattened set of *visible* nodes.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const treeItemRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  // PRC-M454: unique id for the search input so two pickers on one page do not
  // collide (previously a hard-coded `area-picker-search`).
  const reactId = useId();
  const searchInputId = `area-picker-search-${reactId}`;

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

  // PRC-M454: flatten the currently *visible* tree (respecting search filter,
  // expansion and maxDepth) into the order a keyboard user traverses it. This
  // is the model Arrow/Home/End move through.
  interface VisibleNode {
    node: AreaNode;
    depth: number;
    hasChildren: boolean;
    isExpanded: boolean;
  }
  const visibleNodes = useMemo<VisibleNode[]>(() => {
    const out: VisibleNode[] = [];
    const walk = (nodes: AreaNode[], depth: number) => {
      if (maxDepth !== undefined && depth > maxDepth) return;
      for (const node of nodes) {
        if (!matchesSearch(node)) continue;
        const children = getChildren(node);
        const hasChildren = (children && children.length > 0) || !!onLoadChildren;
        const isExpanded = expandedIds.has(node.id);
        out.push({ node, depth, hasChildren, isExpanded });
        if (hasChildren && isExpanded && children) {
          walk(children, depth + 1);
        }
      }
    };
    walk(areas, 0);
    return out;
  }, [areas, matchesSearch, getChildren, onLoadChildren, expandedIds, maxDepth]);

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

  // Close on Escape — PRC-M454: return focus to the trigger button.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // PRC-M454: keep a ref to the latest visible nodes so the open-focus effect
  // can seed the roving focus without taking `visibleNodes` as a dependency
  // (which would re-run it on every expand/filter change).
  const visibleNodesRef = useRef(visibleNodes);
  visibleNodesRef.current = visibleNodes;

  // PRC-M454: on open, seed the roving focus to the first visible node (or the
  // search box when searchable) so keyboard users land inside the tree.
  useEffect(() => {
    if (!isOpen) {
      setActiveNodeId(null);
      return;
    }
    if (searchable) {
      searchInputRef.current?.focus();
    }
    const first = visibleNodesRef.current[0];
    if (first) setActiveNodeId((prev) => prev ?? first.node.id);
  }, [isOpen, searchable]);

  // PRC-M454: move DOM focus to the active treeitem whenever it changes while open.
  useEffect(() => {
    if (!isOpen || activeNodeId == null) return;
    treeItemRefs.current.get(activeNodeId)?.focus();
  }, [isOpen, activeNodeId]);

  const focusNodeAt = useCallback(
    (index: number) => {
      if (visibleNodes.length === 0) return;
      const clamped = Math.max(0, Math.min(index, visibleNodes.length - 1));
      const target = visibleNodes[clamped];
      if (target) setActiveNodeId(target.node.id);
    },
    [visibleNodes],
  );

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

  // PRC-M454: APG tree keyboard interaction. Handles Arrow navigation, Home/End,
  // Enter/Space selection and Right/Left expand/collapse against `visibleNodes`.
  const handleTreeKeyDown = useCallback(
    (event: React.KeyboardEvent, item: VisibleNode) => {
      const index = visibleNodes.findIndex((v) => v.node.id === item.node.id);
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          focusNodeAt(index + 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          focusNodeAt(index - 1);
          break;
        case 'Home':
          event.preventDefault();
          focusNodeAt(0);
          break;
        case 'End':
          event.preventDefault();
          focusNodeAt(visibleNodes.length - 1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          if (item.hasChildren && !item.isExpanded) {
            void toggleExpand(item.node.id);
          } else if (item.hasChildren && item.isExpanded) {
            focusNodeAt(index + 1);
          }
          break;
        case 'ArrowLeft':
          event.preventDefault();
          if (item.hasChildren && item.isExpanded) {
            void toggleExpand(item.node.id);
          } else {
            // Move to parent: the nearest preceding node with a smaller depth.
            for (let i = index - 1; i >= 0; i -= 1) {
              const candidate = visibleNodes[i];
              if (candidate && candidate.depth < item.depth) {
                focusNodeAt(i);
                break;
              }
            }
          }
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          handleSelect(item.node);
          break;
        default:
          break;
      }
    },
    [visibleNodes, focusNodeAt, toggleExpand, handleSelect],
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
    // PRC-M454: roving tabindex — exactly one treeitem is tabbable. The active
    // node (or the first visible node as a fallback) carries tabIndex 0.
    const fallbackActiveId = activeNodeId ?? visibleNodes[0]?.node.id;
    const isActive = node.id === fallbackActiveId;

    return (
      <li
        key={node.id}
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isSelected}
        aria-level={depth + 1}
        className="proctira-area-picker__node"
        tabIndex={isActive ? 0 : -1}
        ref={(el) => {
          if (el) treeItemRefs.current.set(node.id, el);
          else treeItemRefs.current.delete(node.id);
        }}
        onKeyDown={(event) => {
          // keydown bubbles from nested treeitems; only the focused item handles it.
          if (event.target !== event.currentTarget) return;
          handleTreeKeyDown(event, { node, depth, hasChildren: !!hasChildren, isExpanded });
        }}
        onFocus={(event) => {
          // onFocus (focusin) bubbles — only claim the roving focus when this
          // specific treeitem is the focus target, not a descendant treeitem.
          if (event.target === event.currentTarget) setActiveNodeId(node.id);
        }}
      >
        <div
          className={`proctira-area-picker__node-content ${isSelected ? 'proctira-area-picker__node-content--selected' : ''}`}
          style={{ paddingLeft: `${depth * 1.5}rem` }}
        >
          {hasChildren && (
            <button
              type="button"
              tabIndex={-1}
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
            tabIndex={-1}
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
        ref={triggerRef}
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
              <label htmlFor={searchInputId} className="sr-only">
                Search areas
              </label>
              <input
                ref={searchInputRef}
                id={searchInputId}
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
