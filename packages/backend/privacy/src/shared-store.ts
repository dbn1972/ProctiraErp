/**
 * Process-wide shared in-memory privacy store for gateway composition.
 * Ensures student delete gate, tenant delete gate, and /privacy HTTP share holds.
 */
import { InMemoryPrivacyRepository } from './in-memory-repository.js';

let shared: InMemoryPrivacyRepository | null = null;

export function getSharedInMemoryPrivacyRepository(): InMemoryPrivacyRepository {
  if (!shared) {
    shared = new InMemoryPrivacyRepository();
  }
  return shared;
}

/** Test helper — resets the singleton between suites. */
export function resetSharedInMemoryPrivacyRepositoryForTests(): void {
  shared?.clear();
  shared = null;
}
