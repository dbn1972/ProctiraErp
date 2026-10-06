#!/usr/bin/env node
/** Run with: node --test tools/scripts/check-workflow-script-injection.test.mjs */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findScriptInjections } from './check-workflow-script-injection.mjs';

test('flags inputs / event / needs outputs / matrix inlined in run', () => {
  const yml = `
jobs:
  a:
    steps:
      - name: bad-input
        run: echo "services=\${{ inputs.services }}" >> "$GITHUB_OUTPUT"
      - name: bad-branch
        run: B="\${{ github.event.workflow_run.head_branch }}"
      - name: bad-needs
        run: S="\${{ needs.prepare.outputs.services }}"
      - name: bad-matrix
        run: echo \${{ matrix.service }}
`;
  assert.deepEqual(
    findScriptInjections(yml).map((f) => f.step),
    ['bad-input', 'bad-branch', 'bad-needs', 'bad-matrix'],
  );
});

test('allows env indirection, with:, and trusted contexts', () => {
  const yml = `
runs:
  using: composite
  steps:
    - name: ok
      shell: bash
      env:
        SERVICES: \${{ inputs.services }}
      run: echo "$SERVICES \${{ github.sha }} \${{ env.X }} \${{ steps.a.outputs.b }}"
    - uses: actions/checkout@v4
      with:
        ref: \${{ needs.ci-gate.outputs.head-sha }}
`;
  assert.deepEqual(findScriptInjections(yml), []);
});
