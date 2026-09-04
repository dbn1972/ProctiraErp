import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('inventory schema boundary', () => {
  it('declares @@schema("inventory") in shared prisma schema', () => {
    const schemaPath = path.resolve(
      __dirname,
      '../../../shared/database/prisma/schema.prisma',
    );
    const src = fs.readFileSync(schemaPath, 'utf8');
    expect(src).toContain('@@schema("inventory")');
  });
});
