import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import '@testing-library/jest-dom/vitest';

// PRC-M467: the install lock is a global file; give every test file its own so parallel
// test files never share (or delete) each other's lock.
process.env.INSTALL_LOCK_FILE = join(tmpdir(), `proctira-install-test-${randomUUID()}.lock`);
