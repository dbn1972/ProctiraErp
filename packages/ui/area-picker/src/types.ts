export interface AreaNode {
  /** Unique identifier for the area */
  id: string;
  /** Display name */
  name: string;
  /** Parent area ID (null for root nodes) */
  parentId: string | null;
  /** Hierarchy level (0-based) */
  level: number;
  /** Child nodes */
  children?: AreaNode[];
  /** Whether this node can be selected */
  selectable?: boolean;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface AreaPickerProps {
  /** Flat or nested area data */
  areas: AreaNode[];
  /** Currently selected area IDs */
  selectedIds?: string[];
  /** Callback when selection changes */
  onSelect: (selectedIds: string[], selectedNodes: AreaNode[]) => void;
  /** Allow multiple selection */
  multiple?: boolean;
  /** Maximum depth to display */
  maxDepth?: number;
  /** Placeholder text when nothing is selected */
  placeholder?: string;
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Loading state */
  loading?: boolean;
  /** Callback to load children lazily */
  onLoadChildren?: (parentId: string) => Promise<AreaNode[]>;
  /** Accessible label */
  ariaLabel: string;
  /** Additional CSS class name */
  className?: string;
  /** Whether to show search input */
  searchable?: boolean;
}
