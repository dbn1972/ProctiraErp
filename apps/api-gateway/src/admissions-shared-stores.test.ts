/**
 * PRC-L142: the registration and parent-portal mounts share one admissions
 * pipeline store and one CRM store per gateway process.
 */
import { describe, expect, it } from 'vitest';

import { sharedAdmissionsStores } from './domain-plugins.js';

describe('shared admissions stores (PRC-L142)', () => {
  it('returns the same pipeline and CRM store instances on every call', () => {
    const first = sharedAdmissionsStores();
    const second = sharedAdmissionsStores();
    expect(second.pipelineStore).toBe(first.pipelineStore);
    expect(second.crmStore).toBe(first.crmStore);
  });
});
