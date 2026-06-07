/**
 * UI Slot Definition Helper
 *
 * Provides a type-safe way to register UI components in platform
 * extension slots (dashboard widgets, entity detail tabs, etc.).
 */
import type { UISlotLocation } from '@proctira/backend-plugin';

/**
 * A UI slot component definition for registering frontend extensions.
 */
export interface UISlotComponentDefinition {
  /** The UI slot ID to register in (e.g., "student-detail.sidebar") */
  slotId: string;
  /** The component identifier (used by frontend to load the component) */
  componentId: string;
  /** Display label shown in the UI */
  label: string;
  /** Optional icon identifier */
  icon?: string;
  /** Display order within the slot (lower = first) */
  order?: number;
}

/**
 * Define a UI slot component registration.
 *
 * @param slotId - The UI slot to register in
 * @param componentId - The component identifier
 * @param options - Label, icon, and order configuration
 * @returns A UI slot component definition
 *
 * @example
 * ```typescript
 * import { defineUISlot } from '@proctira/plugin-sdk';
 *
 * const dashboardWidget = defineUISlot(
 *   'dashboard-widget.main',
 *   'attendance-summary-widget',
 *   { label: 'Attendance Summary', icon: 'chart-bar', order: 10 }
 * );
 * ```
 */
export function defineUISlot(
  slotId: string,
  componentId: string,
  options: { label: string; icon?: string; order?: number },
): UISlotComponentDefinition {
  if (!slotId) {
    throw new Error('slotId is required for defineUISlot');
  }
  if (!componentId) {
    throw new Error('componentId is required for defineUISlot');
  }
  if (!options.label) {
    throw new Error('options.label is required for defineUISlot');
  }

  return {
    slotId,
    componentId,
    label: options.label,
    icon: options.icon,
    order: options.order ?? 100,
  };
}
