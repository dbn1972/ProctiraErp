/**
 * G-727 — App Router route audit.
 *
 * Every navigation registry in the web app (sidebar, MobileShell tabs and
 * drawer, admin hub cards, help centre guides, 404 suggestions) must point at
 * a route that actually exists on disk. This catches the failure mode G-404
 * fixed by hand — links to pages that were never built — permanently.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ADMIN_SECTIONS, PLATFORM_SECTIONS } from './(dashboard)/admin/admin-sections';
import { navItems } from '@/components/layout/sidebar';
import {
  MOBILE_DRAWER_DESTINATIONS,
  MOBILE_TAB_DESTINATIONS,
} from '@/components/layout/mobile-shell-routes';

const APP_DIR = dirname(fileURLToPath(import.meta.url));

/** Walks `src/app` and returns the URL path for every page.tsx / route.ts. */
function collectRoutes(dir: string, acc: Set<string>): Set<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectRoutes(full, acc);
      continue;
    }
    if (entry !== 'page.tsx' && entry !== 'route.ts') continue;
    const segments = relative(APP_DIR, dirname(full))
      .split(sep)
      .filter((seg) => seg.length > 0 && !(seg.startsWith('(') && seg.endsWith(')')));
    acc.add(`/${segments.join('/')}`.replace(/\/$/, '') || '/');
  }
  return acc;
}

const ROUTES = collectRoutes(APP_DIR, new Set<string>());

/** Matches a concrete href against static routes and `[param]` segments. */
function routeExists(href: string): boolean {
  const path = href.split(/[?#]/)[0] ?? href;
  if (ROUTES.has(path)) return true;
  const parts = path.split('/').filter(Boolean);
  for (const route of ROUTES) {
    const routeParts = route.split('/').filter(Boolean);
    if (routeParts.length !== parts.length) continue;
    if (routeParts.every((seg, i) => seg.startsWith('[') || seg === parts[i])) return true;
  }
  return false;
}

/** Extracts `href: '/x'` and `href="/x"` literals from a source file. */
function hrefsIn(file: string): string[] {
  const src = readFileSync(join(APP_DIR, file), 'utf8');
  return Array.from(src.matchAll(/href(?::\s*|=)["'](\/[^"'\s]*)["']/g), (m) => m[1] ?? '');
}

describe('G-727 App Router route audit', () => {
  it('discovers the dashboard and the G-727 surfaces on disk', () => {
    for (const required of [
      '/',
      '/billing',
      '/audit-logs',
      '/tenant-lifecycle',
      '/help',
      '/admin',
      '/fees',
      '/hostel',
      '/transport',
      '/library',
      '/communication',
    ]) {
      expect(ROUTES.has(required), `${required} missing from src/app`).toBe(true);
    }
  });

  it('discovers G-904 parent and student academic pages on disk', () => {
    for (const required of [
      '/parent/attendance',
      '/parent/grades',
      '/parent/timetable',
      '/parent/homework',
      '/parent/calendar',
      '/parent/notices',
      '/parent/library',
      '/student',
      '/student/attendance',
      '/student/grades',
      '/student/timetable',
      '/student/homework',
      '/student/calendar',
      '/student/notices',
      '/student/pal',
      '/student/library',
    ]) {
      expect(ROUTES.has(required), `${required} missing from src/app`).toBe(true);
    }
  });

  it('sidebar navItems resolve to real routes', () => {
    const dead = navItems.map((i) => i.href).filter((h) => !routeExists(h));
    expect(dead).toEqual([]);
  });

  it('MobileShell tabs + drawer resolve to real routes', () => {
    const dead = [...MOBILE_TAB_DESTINATIONS, ...MOBILE_DRAWER_DESTINATIONS]
      .filter((d) => d.available)
      .map((d) => d.href)
      .filter((h) => !routeExists(h));
    expect(dead).toEqual([]);
  });

  it('MobileShell drawer exposes the campus modules', () => {
    const keys = MOBILE_DRAWER_DESTINATIONS.filter((d) => d.available).map((d) => d.key);
    for (const campus of ['fees', 'hostel', 'transport', 'library', 'communication']) {
      expect(keys, `drawer missing ${campus}`).toContain(campus);
    }
  });

  it('admin hub cards resolve to real routes', () => {
    const dead = [...ADMIN_SECTIONS, ...PLATFORM_SECTIONS]
      .map((s) => s.href)
      .filter((h) => !routeExists(h));
    expect(dead).toEqual([]);
    expect(PLATFORM_SECTIONS.map((s) => s.href)).toEqual([
      '/billing',
      '/audit-logs',
      '/tenant-lifecycle',
    ]);
  });

  it('help centre and 404 suggestions resolve to real routes', () => {
    for (const file of ['(dashboard)/help/page.tsx', 'not-found.tsx']) {
      const hrefs = hrefsIn(file);
      expect(hrefs.length, `${file} has no links`).toBeGreaterThan(0);
      const dead = hrefs.filter((h) => !routeExists(h));
      expect(dead, `${file} dead links`).toEqual([]);
    }
  });

  it('ships an app-level not-found boundary', () => {
    expect(() => statSync(join(APP_DIR, 'not-found.tsx'))).not.toThrow();
  });
});
