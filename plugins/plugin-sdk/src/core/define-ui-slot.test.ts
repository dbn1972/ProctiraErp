/**
 * Tests for defineUISlot (PRC-L486: previously untested SDK area).
 */
import { describe, it, expect } from 'vitest';
import { defineUISlot } from './define-ui-slot.js';

describe('defineUISlot', () => {
  it('returns the definition with the given label, icon and order', () => {
    expect(
      defineUISlot('dashboard.widget', 'attendance-widget', {
        label: 'Attendance',
        icon: 'chart-bar',
        order: 10,
      }),
    ).toEqual({
      slotId: 'dashboard.widget',
      componentId: 'attendance-widget',
      label: 'Attendance',
      icon: 'chart-bar',
      order: 10,
    });
  });

  it('defaults order to 100 and leaves icon undefined', () => {
    const slot = defineUISlot('dashboard.widget', 'w', { label: 'W' });
    expect(slot.order).toBe(100);
    expect(slot.icon).toBeUndefined();
  });

  it('throws when slotId is missing', () => {
    expect(() => defineUISlot('', 'w', { label: 'W' })).toThrow(/slotId is required/);
  });

  it('throws when componentId is missing', () => {
    expect(() => defineUISlot('dashboard.widget', '', { label: 'W' })).toThrow(
      /componentId is required/,
    );
  });

  it('throws when options.label is missing', () => {
    expect(() => defineUISlot('dashboard.widget', 'w', { label: '' })).toThrow(
      /options\.label is required/,
    );
  });
});
