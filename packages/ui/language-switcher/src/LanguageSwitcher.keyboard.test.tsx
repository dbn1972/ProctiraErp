import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LanguageSwitcher } from './LanguageSwitcher';
import type { Language } from './types';

const languages: Language[] = [
  { code: 'en', nativeName: 'English', englishName: 'English', rtl: false },
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', rtl: true },
  { code: 'fr', nativeName: 'Français', englishName: 'French', rtl: false },
];

const setup = (onLanguageChange = vi.fn()) => {
  render(
    <LanguageSwitcher
      languages={languages}
      currentLanguage="ar"
      onLanguageChange={onLanguageChange}
    />,
  );
  return screen.getByRole('button', { name: /change language/i });
};

describe('LanguageSwitcher disclosure keyboard (PRC-L521)', () => {
  it('uses a disclosure pattern without listbox/option roles', () => {
    const trigger = setup();
    fireEvent.click(trigger);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Available languages' });
    expect(trigger).toHaveAttribute('aria-controls', list.id);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens with ArrowDown, focuses current, arrows/Home/End move, Escape returns focus', () => {
    const trigger = setup();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const current = screen.getByRole('button', { name: /العربية \(Arabic\)/ });
    expect(current).toHaveFocus();
    expect(current).toHaveAttribute('aria-current', 'true');
    fireEvent.keyDown(current, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: /Français/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: /^English \(English\)$/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
    expect(screen.getByRole('button', { name: /Français/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
    expect(screen.getByRole('button', { name: /^English \(English\)$/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    expect(screen.getByRole('button', { name: /Français/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('returns focus to the trigger after selecting a language', () => {
    const onLanguageChange = vi.fn();
    const trigger = setup(onLanguageChange);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: /Français/ }));
    expect(onLanguageChange).toHaveBeenCalledWith('fr');
    expect(trigger).toHaveFocus();
  });

  it('accessible names start with the visible text (label in name)', () => {
    const trigger = setup();
    expect(trigger.textContent).toContain('العربية');
    expect(trigger.getAttribute('aria-label')?.startsWith('العربية')).toBe(true);
    fireEvent.click(trigger);
    const option = screen.getByRole('button', { name: /Français/ });
    expect(option).not.toHaveAttribute('aria-label');
  });
});
