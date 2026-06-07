#!/usr/bin/env node

/**
 * ProctiraERP Install CLI - Binary entry point.
 *
 * This file is the executable entry point for the CLI tool.
 * It uses tsx to run the TypeScript source directly during development.
 */

import { run } from '../src/index.ts';

run(process.argv).catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exitCode = 1;
});
