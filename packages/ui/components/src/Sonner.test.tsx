import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * PRC-L593: the toaster must follow an explicit `theme` prop instead of the
 * old `globalThis.require('next-themes')` hack (a conditional-hook violation
 * that silently never worked in browser/ESM bundles — toasts were always
 * rendered with the "system" theme). We mock the underlying `sonner`
 * `Toaster` and assert the resolved theme it receives.
 */
const themeSpy = vi.fn();
vi.mock('sonner', () => ({
  Toaster: (props: { theme?: string }) => {
    themeSpy(props.theme);
    return <div data-testid="sonner" data-theme={props.theme} />;
  },
}));

// Import after the mock is registered.
import { Toaster } from './Sonner';

describe('Toaster (PRC-L593)', () => {
  it('defaults to the system theme', () => {
    render(<Toaster />);
    expect(themeSpy).toHaveBeenLastCalledWith('system');
  });

  it('forwards an explicit dark theme to sonner', () => {
    render(<Toaster theme="dark" />);
    expect(themeSpy).toHaveBeenLastCalledWith('dark');
  });

  it('forwards an explicit light theme to sonner', () => {
    render(<Toaster theme="light" />);
    expect(themeSpy).toHaveBeenLastCalledWith('light');
  });
});
