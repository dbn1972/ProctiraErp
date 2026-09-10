import { describe, expect, it } from 'vitest';

import { actorUuid } from './prisma-attendance-repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('actorUuid — recorded_by is a NOT NULL UUID column', () => {
  it('passes real UUIDs through unchanged', () => {
    const id = '7d2f9e1c-3a4b-4c5d-8e6f-0a1b2c3d4e5f';
    expect(actorUuid(id)).toBe(id);
  });

  it('maps opaque subjects to a stable RFC 4122 v5 UUID', () => {
    const a = actorUuid('e2e-admin');
    expect(a).toMatch(UUID_RE);
    expect(actorUuid('e2e-admin')).toBe(a);
    expect(actorUuid('system')).toMatch(UUID_RE);
    expect(actorUuid('system')).not.toBe(a);
  });
});
