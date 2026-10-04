// PRC-L187: alert rules are matched structurally, not by substring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { checkAlertRules } from './observability-alert-rules.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const availability = readFileSync(
  resolve(root, 'infra/observability/alerts/availability.yml'),
  'utf8',
);

test('shipped availability rules satisfy the expected names', () => {
  assert.deepEqual(
    checkAlertRules(parse(availability), ['ServiceErrorRateHigh', 'ServiceDown']),
    [],
  );
});

test('commenting out ServiceDown fails the check', () => {
  const lines = availability.split('\n');
  const start = lines.findIndex((l) => /^\s*- alert: ServiceDown\s*$/.test(l));
  assert.ok(start >= 0, 'fixture must contain ServiceDown');
  const indent = lines[start].indexOf('-');
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' || lines[end].search(/\S/) > indent))
    end++;
  for (let i = start; i < end; i++) lines[i] = `#${lines[i]}`;
  const commented = lines.join('\n');
  // The name is still in the text — a substring check would have passed.
  assert.ok(commented.includes('ServiceDown'));
  assert.deepEqual(checkAlertRules(parse(commented), ['ServiceDown']), [
    'missing rule ServiceDown',
  ]);
});

test('rules without expr or for fail', () => {
  const doc = {
    groups: [
      {
        rules: [
          { alert: 'A', for: '5m' },
          { alert: 'B', expr: 'up == 0' },
        ],
      },
    ],
  };
  assert.deepEqual(checkAlertRules(doc, ['A', 'B']), [
    'rule A has no expr',
    'rule B has no for duration',
  ]);
});

test('a document without groups fails closed', () => {
  assert.deepEqual(checkAlertRules(null, ['A']), ['rules file has no `groups:` list']);
});
