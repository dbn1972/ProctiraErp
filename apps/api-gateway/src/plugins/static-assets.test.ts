/**
 * Tests for the static-assets plugin (Task 55.6 / Requirement 39).
 *
 * These tests build a real Fastify instance, register the plugin
 * against a temporary directory containing a JS file plus its `.gz`
 * and `.br` siblings, and assert:
 *
 *   1. `Accept-Encoding: br, gzip` returns `Content-Encoding: br`
 *      (brotli is preferred over gzip when both are accepted).
 *   2. `Accept-Encoding: gzip` returns `Content-Encoding: gzip`.
 *   3. A request without `Accept-Encoding` returns the uncompressed
 *      file with no `Content-Encoding` header.
 *   4. Every response includes `Vary: Accept-Encoding` so caches do
 *      not collapse the encoded and identity variants.
 *   5. The original `Content-Type` (here `application/javascript`)
 *      is preserved regardless of the served encoding.
 *
 * The unit tests for `parseAcceptEncoding` and
 * `buildForwardedAcceptEncoding` cover header-parsing edge cases
 * without touching the filesystem.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import staticAssetsPlugin, {
  buildForwardedAcceptEncoding,
  parseAcceptEncoding,
} from './static-assets.js';

describe('parseAcceptEncoding', () => {
  it('returns an empty set when the header is missing', () => {
    expect(parseAcceptEncoding(undefined)).toEqual(new Set());
  });

  it('parses a comma-separated list of encodings', () => {
    expect(parseAcceptEncoding('br, gzip')).toEqual(new Set(['br', 'gzip']));
  });

  it('honours q=0 to explicitly disable an encoding', () => {
    expect(parseAcceptEncoding('gzip;q=0')).toEqual(new Set());
    expect(parseAcceptEncoding('br, gzip;q=0')).toEqual(new Set(['br']));
  });

  it('expands the wildcard to every supported encoding', () => {
    expect(parseAcceptEncoding('*')).toEqual(new Set(['br', 'gzip']));
  });

  it('combines wildcard expansion with explicit q=0 disables', () => {
    expect(parseAcceptEncoding('*, gzip;q=0')).toEqual(new Set(['br']));
  });

  it('ignores encodings the gateway does not support', () => {
    expect(parseAcceptEncoding('deflate, identity, br')).toEqual(new Set(['br']));
  });

  it('treats q=0 as a hard disable even when the encoding is also enabled', () => {
    // RFC 9110: the q=0 entry wins.
    expect(parseAcceptEncoding('gzip, gzip;q=0')).toEqual(new Set());
  });
});

describe('buildForwardedAcceptEncoding', () => {
  it('emits encodings in the gateway-preferred order (brotli first)', () => {
    expect(buildForwardedAcceptEncoding(new Set(['gzip', 'br']))).toBe('br, gzip');
  });

  it('returns an empty string when no supported encodings are accepted', () => {
    expect(buildForwardedAcceptEncoding(new Set())).toBe('');
  });
});

describe('static-assets plugin', () => {
  let app: FastifyInstance;
  let tmpRoot: string;
  const originalContent = Buffer.from(
    // ~3 KiB of repetitive text so each encoding yields a distinct payload.
    'console.log("proctira static asset");\n'.repeat(80),
    'utf8',
  );
  const gzipContent = gzipSync(originalContent, { level: 9 });
  const brotliContent = brotliCompressSync(originalContent);

  beforeAll(async () => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'proctira-static-'));
    const assetPath = path.join(tmpRoot, 'app.js');
    writeFileSync(assetPath, originalContent);
    writeFileSync(`${assetPath}.gz`, gzipContent);
    writeFileSync(`${assetPath}.br`, brotliContent);

    app = Fastify({ logger: false });
    await app.register(staticAssetsPlugin, {
      root: tmpRoot,
      prefix: '/static/',
      spaFallback: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('serves the brotli sibling when Accept-Encoding includes br and gzip', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/static/app.js',
      headers: { 'accept-encoding': 'br, gzip' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBe('br');
    expect(response.headers['content-type']).toMatch(/javascript/);
    expect(response.headers['vary']).toMatch(/accept-encoding/i);
    expect(response.rawPayload).toEqual(brotliContent);
  });

  it('serves the gzip sibling when Accept-Encoding only includes gzip', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/static/app.js',
      headers: { 'accept-encoding': 'gzip' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.headers['content-type']).toMatch(/javascript/);
    expect(response.headers['vary']).toMatch(/accept-encoding/i);
    expect(response.rawPayload).toEqual(gzipContent);
  });

  it('serves the uncompressed file when Accept-Encoding is absent', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/static/app.js',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.headers['content-type']).toMatch(/javascript/);
    expect(response.headers['vary']).toMatch(/accept-encoding/i);
    expect(response.rawPayload).toEqual(originalContent);
  });

  it('serves the uncompressed file when only an unsupported encoding is offered', async () => {
    // `deflate` is intentionally not produced at build time; the gateway
    // must fall back to identity rather than 406 the request.
    const response = await app.inject({
      method: 'GET',
      url: '/static/app.js',
      headers: { 'accept-encoding': 'deflate' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.rawPayload).toEqual(originalContent);
  });

  it('respects q=0 to opt out of an otherwise accepted encoding', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/static/app.js',
      headers: { 'accept-encoding': 'br;q=0, gzip' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.rawPayload).toEqual(gzipContent);
  });
});
