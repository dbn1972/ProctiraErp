import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import '@testing-library/jest-dom/vitest';
import { afterAll } from 'vitest';

// PRC-M467: the install lock is a global file; give every test file its own so parallel
// test files never share (or delete) each other's lock, and remove it afterwards.
const lockFile = join(tmpdir(), `proctira-install-test-${randomUUID()}.lock`);
process.env.INSTALL_LOCK_FILE = lockFile;
afterAll(() => {
  rmSync(lockFile, { force: true });
});
