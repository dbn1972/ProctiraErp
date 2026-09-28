'use client';

import { useEffect, useSyncExternalStore } from 'react';

export interface InstitutionScope {
  id: string;
  areaLabel: string | null;
}

let scope: InstitutionScope | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setInstitutionScope(next: InstitutionScope | null) {
  scope = next;
  emit();
}

export function getInstitutionScope(): InstitutionScope | null {
  return scope;
}

export function subscribeInstitutionScope(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInstitutionScope(): InstitutionScope | null {
  return useSyncExternalStore(subscribeInstitutionScope, getInstitutionScope, () => null);
}

/** Institution detail pages publish the selected school's area for the sidebar. */
export function InstitutionScopeRegistrar(props: { id: string; areaLabel: string | null }) {
  useEffect(() => {
    setInstitutionScope({ id: props.id, areaLabel: props.areaLabel });
    return () => setInstitutionScope(null);
  }, [props.id, props.areaLabel]);
  return null;
}
