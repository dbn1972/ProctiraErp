'use client';

import type { LucideIcon, LucideProps } from 'lucide-react';
import * as React from 'react';

import { cn } from './lib/utils';

/**
 * `<DirectionalIcon>` — RTL-aware wrapper for *directional* lucide-react icons.
 *
 * Task 48.3 / Requirements 18.7, 18.10, 18.11 / Design §C.
 *
 * Some icons carry an inherent left/right semantic (e.g. ChevronRight points
 * "forward"). When the document direction flips to RTL, those icons must
 * mirror horizontally so the visual reading order still tracks the logical
 * one. Other icons (Search, User, Calendar, Bell, …) are direction-neutral
 * and MUST NOT mirror; rendering them through this wrapper would visually
 * break their meaning.
 *
 * ## Usage
 *
 * ```tsx
 * import { ChevronRight } from 'lucide-react';
 * import { DirectionalIcon } from '@proctira/ui/components';
 * import { useLanguage } from '@/providers/LanguageProvider';
 *
 * function NextLink() {
 *   const { dir } = useLanguage();
 *   return <DirectionalIcon icon={ChevronRight} dir={dir} aria-hidden />;
 * }
 * ```
 *
 * The wrapper is intentionally framework-agnostic: it accepts a `dir` prop
 * rather than reading from a React context so it can be used by code that
 * lives outside the apps/web `<LanguageProvider>` tree (Storybook,
 * standalone marketing pages, mobile shell experiments). When `dir` is
 * omitted the wrapper falls back to `document.documentElement.dir`, which
 * `<LanguageProvider>` keeps in sync with the active locale (Task 48.1).
 *
 * ## Directional vs non-directional icons
 *
 * Use `<DirectionalIcon>` for icons whose meaning depends on text
 * direction:
 *
 *   ChevronRight, ChevronLeft, ChevronsRight, ChevronsLeft,
 *   ArrowRight, ArrowLeft, ArrowUpRight, ArrowDownLeft, …,
 *   IndentIncrease, IndentDecrease,
 *   Reply, ReplyAll, Forward,
 *   CornerDownRight, CornerUpRight, CornerDownLeft, CornerUpLeft,
 *   PanelLeftOpen, PanelRightOpen, …,
 *   ArrowBigRight, ArrowBigLeft, MoveRight, MoveLeft, …
 *
 * Do NOT wrap direction-neutral icons (they bypass the wrapper):
 *
 *   Search, User, Calendar, Bell, Settings, Globe, Sun, Moon, Check,
 *   Plus, Minus, X, Menu, Filter, Download, Upload, Mail, Phone,
 *   Eye, EyeOff, Lock, Unlock, Star, Heart, Trash, Save, Edit,
 *   Loader, Spinner-style icons, brand/logo icons, … (anything whose
 *   left/right halves are visually symmetric or have no directional
 *   meaning).
 */

export interface DirectionalIconProps extends Omit<LucideProps, 'ref'> {
  /**
   * The directional lucide-react icon component to render. Pass the
   * component itself, not an instance:
   *
   * ```tsx
   * <DirectionalIcon icon={ChevronRight} />     // ✅
   * <DirectionalIcon icon={<ChevronRight />} /> // ❌
   * ```
   */
  icon: LucideIcon;

  /**
   * Direction of the surrounding document. When `'rtl'`, the icon is
   * mirrored horizontally via a CSS transform. When `'ltr'` (or `undefined`
   * outside the browser), the icon renders as-is.
   *
   * Omit to inherit `document.documentElement.dir`. Inheriting works at
   * runtime because `<LanguageProvider>` (task 48.1) stamps the attribute
   * on every locale change; during SSR the attribute is also set in
   * `app/layout.tsx`. Tests that don't mount a provider can pass the
   * direction explicitly.
   */
  dir?: 'ltr' | 'rtl';
}

/** Reads `<html dir>` defensively so SSR / non-DOM contexts return `'ltr'`. */
function readDocumentDir(): 'ltr' | 'rtl' {
  if (typeof document === 'undefined') return 'ltr';
  return document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
}

export const DirectionalIcon = React.forwardRef<SVGSVGElement, DirectionalIconProps>(
  function DirectionalIcon({ icon: Icon, dir, className, ...rest }, ref) {
    const resolvedDir = dir ?? readDocumentDir();
    const shouldFlip = resolvedDir === 'rtl';

    return (
      <Icon
        ref={ref}
        className={cn(shouldFlip && '-scale-x-100', className)}
        data-rtl-flipped={shouldFlip ? 'true' : undefined}
        {...rest}
      />
    );
  },
);

DirectionalIcon.displayName = 'DirectionalIcon';
