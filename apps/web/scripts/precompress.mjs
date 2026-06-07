#!/usr/bin/env node
/**
 * Next.js post-build pre-compression (Task 55.6 / Requirement 39)
 *
 * Walks the `.next/static/` and `.next/server/` build outputs and
 * emits `.gz` (gzip level 9) + `.br` (brotli quality 11) siblings for
 * every text-like artifact above the size threshold. The Node server,
 * Nginx ingress, or CDN can then serve the pre-compressed sibling
 * matching the client's `Accept-Encoding` header without paying the
 * encoding cost on every request.
 *
 * Behaviour:
 *  - Only files matching COMPRESSIBLE_PATTERN are considered. Already
 *    compressed formats (jpg, png, woff2, ico, ...) are skipped.
 *  - Files smaller than COMPRESSION_THRESHOLD_BYTES (1 KiB) are
 *    skipped — the wire-overhead of a Content-Encoding handshake
 *    outweighs the savings on tiny payloads.
 *  - The `.gz` / `.br` siblings are only kept if they actually shrink
 *    the file. If compression makes the file larger (rare for text
 *    but possible for tiny inputs that survived the threshold), the
 *    sibling is discarded.
 *  - Existing `.gz` / `.br` files are never re-walked — we never want
 *    to compress a compressed file.
 *
 * The script is intentionally synchronous-friendly (no parallel
 * worker pool) so the postbuild step stays predictable in CI; gzip
 * and brotli at maximum level run in well under a second per chunk.
 *
 * Exit codes:
 *   0 — success (or no `.next` directory, e.g. when build was skipped)
 *   1 — unexpected error during compression
 */

import { promises as fs } from 'node:fs';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

// File extensions that benefit from text compression. Already-
// compressed formats (jpg, png, woff2, ico, ...) are intentionally
// excluded — re-encoding would only inflate them.
const COMPRESSIBLE_PATTERN = /\.(js|mjs|cjs|css|html|svg|json|txt|xml|map|wasm)$/i;

// Skip artifacts smaller than 1 KiB.
const COMPRESSION_THRESHOLD_BYTES = 1024;

// Roots under `apps/web` to walk after `next build`.
const TARGET_ROOTS = ['.next/static', '.next/server'];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Resolve relative to the app root regardless of cwd.
const APP_ROOT = path.resolve(__dirname, '..');

/**
 * Recursively yields absolute file paths under `dir`.
 * Symlinks are not followed; that is sufficient for `.next` outputs
 * which are produced by Next.js itself.
 */
async function* walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/**
 * Compresses a single file into `.gz` and `.br` siblings.
 * Returns the number of siblings actually written (0, 1, or 2).
 */
async function compressFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  // Never recurse into our own output.
  if (ext === '.gz' || ext === '.br') return 0;
  if (!COMPRESSIBLE_PATTERN.test(filePath)) return 0;

  const stat = await fs.stat(filePath);
  if (stat.size < COMPRESSION_THRESHOLD_BYTES) return 0;

  const buffer = await fs.readFile(filePath);

  const [gz, br] = await Promise.all([
    gzipAsync(buffer, { level: 9 }),
    brotliAsync(buffer, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buffer.length,
      },
    }),
  ]);

  let written = 0;

  // Only emit a sibling when it is actually smaller than the original;
  // otherwise the server would prefer the encoded variant for no win.
  if (gz.length < buffer.length) {
    await fs.writeFile(`${filePath}.gz`, gz);
    written += 1;
  }
  if (br.length < buffer.length) {
    await fs.writeFile(`${filePath}.br`, br);
    written += 1;
  }

  return written;
}

async function main() {
  let totalScanned = 0;
  let totalCompressed = 0;
  let totalSiblings = 0;

  for (const relRoot of TARGET_ROOTS) {
    const root = path.join(APP_ROOT, relRoot);
    try {
      await fs.access(root);
    } catch {
      // Directory does not exist (e.g. `next build` was skipped or
      // produced no server output). That is not an error.
      continue;
    }

    for await (const file of walk(root)) {
      totalScanned += 1;
      const written = await compressFile(file);
      if (written > 0) {
        totalCompressed += 1;
        totalSiblings += written;
      }
    }
  }

  // Plain stdout so the postbuild output is greppable in CI logs.
  // eslint-disable-next-line no-console
  console.log(
    `[precompress] scanned ${totalScanned} files, compressed ${totalCompressed}, wrote ${totalSiblings} sibling(s) (.gz/.br)`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[precompress] failed:', err);
  process.exit(1);
});
