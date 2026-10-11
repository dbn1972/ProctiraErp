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

  it('escapes literal segments so tenant ids cannot inject regex', () => {
    const re = wildcardTopicToRegExp('tenant.a.c.jobs');
    // The dot is a literal separator, not "any char".
    expect(re.test('tenant.aXc.jobs')).toBe(false);
    expect(re.test('tenant.a.c.jobs')).toBe(true);
  });
});
