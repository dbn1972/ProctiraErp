#!/usr/bin/env node
/**
 * Write the three Sunrise scholarship placeholder PDFs next to the object
 * keys stored by db/seeds/006_sunrise_public_school_demo.sql.
 *
 *   SCHOLARSHIP_DOCUMENT_DIR=/tmp/proctira-scholarship-documents \
 *     node db/seeds/write-sunrise-scholarship-placeholders.mjs
 *
 * The bytes are the canonical 118-byte PDF (sha256 7856c8e9…). Not a scanned
 * identity document.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
const SHA = '7856c8e9ef203bbcac0d98630035fd1ced46f1bdd446c940d6411e183f6073ec';
const APP = '00000000-0000-4000-8000-00000000a5e2';
const IDS = [
  '00000000-0000-4000-8000-00000000a5e3',
  '00000000-0000-4000-8000-00000000a5e4',
  '00000000-0000-4000-8000-00000000a5e5',
];

const actual = createHash('sha256').update(PDF).digest('hex');
if (actual !== SHA) {
  console.error(`placeholder sha256 ${actual} does not match ${SHA}`);
  process.exit(1);
}

const root =
  process.env.SCHOLARSHIP_DOCUMENT_DIR ?? join(tmpdir(), 'proctira-scholarship-documents');
for (const id of IDS) {
  const key = `scholarships/${APP}/documents/${id}`;
  const full = join(root, key);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, PDF);
  console.log(full);
}
