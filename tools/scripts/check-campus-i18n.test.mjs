#!/usr/bin/env node
/**
 * PRC-L179 — campus i18n gate compares full nested key sets to en.json and
 * fails closed when no locales are found.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_MESSAGES_DIR,
  REQUIRED,
  evaluateCampusI18n,
  loadLocales,
} from './check-campus-i18n.mjs';

function baseMessages() {
  /** @type {Record<string, Record<string, unknown>>} */
  const msgs = {};
  for (const [ns, keys] of Object.entries(REQUIRED)) {
    msgs[ns] = Object.fromEntries(keys.map((k) => [k, `${ns} ${k}`]));
  }
  msgs.fees.status = { paid: 'Paid', overdue: 'Overdue' };
  return msgs;
}

test('passes when every locale matches en.json campus key sets', () => {
  const r = evaluateCampusI18n({ 'en.json': baseMessages(), 'hi.json': baseMessages() });
  assert.deepEqual(r.errors, []);
  assert.equal(r.localeCount, 2);
});

test('locale missing a nested key fails', () => {
  const hi = baseMessages();
  delete hi.fees.status.overdue;
  const r = evaluateCampusI18n({ 'en.json': baseMessages(), 'hi.json': hi });
  assert.deepEqual(r.errors, ['hi.json:fees.status.overdue']);
});

test('empty string value fails', () => {
  const ta = baseMessages();
  ta.nav.hostel = '  ';
  const r = evaluateCampusI18n({ 'en.json': baseMessages(), 'ta.json': ta });
  assert.deepEqual(r.errors, ['ta.json:nav.hostel']);
});

test('no locales found fails closed', () => {
  assert.deepEqual(evaluateCampusI18n({}).errors, ['no locale files found']);
  assert.deepEqual(loadLocales('/nonexistent/prc-l179'), {});
});

test('missing base locale fails closed', () => {
  const r = evaluateCampusI18n({ 'hi.json': baseMessages() });
  assert.match(r.errors[0], /base locale en\.json not found/);
});

test('on-disk apps/web messages pass the gate', () => {
  const r = evaluateCampusI18n(loadLocales(DEFAULT_MESSAGES_DIR));
  assert.deepEqual(r.errors, []);
  assert.ok(r.localeCount >= 2);
});
