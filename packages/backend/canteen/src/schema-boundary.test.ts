import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('canteen schema boundary', () => {
  it('declares @@schema("canteen") in shared prisma schema', () => {
    const schemaPath = path.resolve(
      __dirname,
      '../../../shared/database/prisma/schema.prisma',
    );
    const src = fs.readFileSync(schemaPath, 'utf8');
    expect(src).toContain('@@schema("canteen")');
  });
});
