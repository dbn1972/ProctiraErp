/**
 * PRC-M053 — every advertised locale ships a message catalog with key parity
 * to en.json, and the switcher offers no locale without one.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { locales, rtlLocales } from './config';

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'messages');

type Tree = { [key: string]: string | Tree };
function keys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  );
}
function load(locale: string): Tree {
  return JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), 'utf8')) as Tree;
}

describe('PRC-M053 locale catalogs', () => {
  const en = new Set(keys(load('en')));

  it('every locale has a catalog file', () => {
    expect(locales.every((l) => existsSync(join(messagesDir, `${l}.json`)))).toBe(true);
  });

  it.each(locales.filter((l) => l !== 'en'))('%s has key parity with en.json', (locale) => {
    const k = new Set(keys(load(locale)));
    expect([...en].filter((key) => !k.has(key))).toEqual([]);
    expect([...k].filter((key) => !en.has(key))).toEqual([]);
  });

  it('Hebrew is not advertised without a catalog', () => {
    expect((locales as readonly string[]).includes('he')).toBe(false);
    expect(rtlLocales.has('he')).toBe(false);
  });
});
