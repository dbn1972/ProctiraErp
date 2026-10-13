/**
 * PRC-M365 — wildcard topics must translate to a RegExp (Kafka) or fail closed
 * (SQS), never be treated as a literal topic/queue name.
 * PRC-L582 — RabbitMQ subscribe() fan-out must use a distinct consumer group per
 * service, never a shared default queue.
 */
import { describe, it, expect } from 'vitest';

import { isWildcardTopic, wildcardTopicToRegExp } from '../index';

describe('PRC-M365 wildcard topic helpers', () => {
  it('detects AMQP-style wildcards', () => {
    expect(isWildcardTopic('tenant.*.jobs')).toBe(true);
    expect(isWildcardTopic('tenant.#')).toBe(true);
    expect(isWildcardTopic('tenant.acme.jobs.created')).toBe(false);
  });

  it('* matches exactly one segment', () => {
    const re = wildcardTopicToRegExp('tenant.*.jobs');
    expect(re.test('tenant.acme.jobs')).toBe(true);
    expect(re.test('tenant.beta.jobs')).toBe(true);
    // Not zero segments, not two segments in the wildcard slot.
    expect(re.test('tenant..jobs')).toBe(false);
    expect(re.test('tenant.acme.extra.jobs')).toBe(false);
    // Different trailing segment must not match.
    expect(re.test('tenant.acme.other')).toBe(false);
  });

  it('# matches zero or more trailing segments', () => {
    const re = wildcardTopicToRegExp('tenant.acme.#');
    expect(re.test('tenant.acme')).toBe(true);
    expect(re.test('tenant.acme.jobs')).toBe(true);
    expect(re.test('tenant.acme.jobs.created')).toBe(true);
    expect(re.test('tenant.beta.jobs')).toBe(false);
  });

  it('trailing # must not cross a sibling tenant prefix (PRC-L355)', () => {
    const re = wildcardTopicToRegExp('tenant.abc.#');
    // Exact tenant: fine.
    expect(re.test('tenant.abc')).toBe(true);
    expect(re.test('tenant.abc.jobs')).toBe(true);
    // Sibling tenants whose slug starts with "abc" must NOT match — this was
    // the leak: the dot before `#` must be mandatory when a segment follows.
    expect(re.test('tenant.abc-evil.jobs')).toBe(false);
    expect(re.test('tenant.abcdef')).toBe(false);
    expect(re.test('tenant.abcdef.jobs')).toBe(false);
  });

  it('leading # matches zero or more leading segments without crossing boundaries', () => {
    const re = wildcardTopicToRegExp('#.jobs');
    expect(re.test('jobs')).toBe(true);
    expect(re.test('tenant.acme.jobs')).toBe(true);
    // Must still anchor on the trailing literal segment.
    expect(re.test('tenant.acme.jobs.created')).toBe(false);
    expect(re.test('tenant.acme.other')).toBe(false);
  });

  it('trailing # on a tenant keeps the segment boundary (review blocker 2)', () => {
    const re = wildcardTopicToRegExp('tenant.abc.#');
    expect(re.test('tenant.abc')).toBe(true);
    expect(re.test('tenant.abc.x.y')).toBe(true);
    expect(re.test('tenant.abc-evil.jobs')).toBe(false);
  });
  it('leading # absorbs its following separator only', () => {
    const re = wildcardTopicToRegExp('#.jobs');
    expect(re.test('jobs')).toBe(true);
    expect(re.test('tenant.acme.jobs')).toBe(true);
    expect(re.test('evil-jobs')).toBe(false);
    expect(re.test('tenant.acmejobs')).toBe(false);
  });
  it('interior # keeps segment boundaries on both sides', () => {
    const re = wildcardTopicToRegExp('tenant.#.abc.jobs');
    expect(re.test('tenant.abc.jobs')).toBe(true);
    expect(re.test('tenant.x.abc.jobs')).toBe(true);
    expect(re.test('tenant.x.y.abc.jobs')).toBe(true);
    expect(re.test('tenant.evilabc.jobs')).toBe(false);
    expect(re.test('tenantabc.jobs')).toBe(false);
  });
  it('interior # after * keeps the boundary before the trailing literal', () => {
    const re = wildcardTopicToRegExp('tenant.*.#.created');
    expect(re.test('tenant.abc.created')).toBe(true);
    expect(re.test('tenant.abc.x.created')).toBe(true);
    expect(re.test('tenant.abc.uncreated')).toBe(false);
    expect(re.test('tenant.created')).toBe(false);
  });
  it('bare # matches any topic', () => {
    const re = wildcardTopicToRegExp('#');
    expect(re.test('jobs')).toBe(true);
    expect(re.test('a.b.c')).toBe(true);
    expect(re.test('tenant.acme.jobs.created')).toBe(true);
  });
  it('consecutive # collapse to one', () => {
    expect(wildcardTopicToRegExp('#.#').test('a.b')).toBe(true);
    expect(wildcardTopicToRegExp('#.#').test('jobs')).toBe(true);
    const re = wildcardTopicToRegExp('tenant.#.#.jobs');
    expect(re.test('tenant.jobs')).toBe(true);
    expect(re.test('tenant.a.b.jobs')).toBe(true);
    expect(re.test('tenant.ajobs')).toBe(false);
  });
  it('escapes literal segments so tenant ids cannot inject regex', () => {
    const re = wildcardTopicToRegExp('tenant.a.c.jobs');
    // The dot is a literal separator, not "any char".
    expect(re.test('tenant.aXc.jobs')).toBe(false);
    expect(re.test('tenant.a.c.jobs')).toBe(true);
  });
});
