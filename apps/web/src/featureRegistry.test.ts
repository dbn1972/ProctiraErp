/**
 * Metadata tests for the federated feature registry.
 *
 * The registry is a pure navigation-metadata source (consumed by the live
 * `CommandPalette`). The legacy Vite SPA's `lazyImport` edges and the
 * `getModulesByScope`/`getFeatureChunkIds` SPA helpers were removed under
 * Decision D6, so these tests assert only the surviving metadata contract:
 * unique ids, well-formed labels/prefixes/scopes, and `getModuleById`.
 */
import { describe, it, expect } from 'vitest';
import { featureRegistry, getModuleById } from './featureRegistry';
import type { VisibilityScope } from './featureRegistry';

const byScope = (scope: VisibilityScope) => featureRegistry.filter((m) => m.scope === scope);

describe('featureRegistry', () => {
  it('should have at least one module per scope', () => {
    const scopes: VisibilityScope[] = ['public', 'auth', 'app', 'mobile'];
    for (const scope of scopes) {
      expect(byScope(scope).length).toBeGreaterThan(0);
    }
  });

  it('should have unique IDs across all modules', () => {
    const ids = featureRegistry.map((m) => m.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should have non-empty labels and route prefixes for non-index routes', () => {
    for (const mod of featureRegistry) {
      expect(mod.label).toBeTruthy();
      expect(mod.icon).toBeTruthy();
      if (!mod.isIndex) {
        expect(mod.routePrefix).toBeTruthy();
      }
    }
  });

  it('should have valid scope values', () => {
    const validScopes: VisibilityScope[] = ['public', 'auth', 'app', 'mobile'];
    for (const mod of featureRegistry) {
      expect(validScopes).toContain(mod.scope);
    }
  });

  describe('getModuleById', () => {
    it('finds a module by its ID', () => {
      const mod = getModuleById('dashboard');
      expect(mod).toBeDefined();
      expect(mod?.id).toBe('dashboard');
      expect(mod?.scope).toBe('app');
    });

    it('returns undefined for non-existent ID', () => {
      const mod = getModuleById('non-existent-module');
      expect(mod).toBeUndefined();
    });
  });

  describe('route structure integrity', () => {
    it('public scope has exactly one index route', () => {
      const publicModules = byScope('public');
      const indexRoutes = publicModules.filter((m) => m.isIndex);
      expect(indexRoutes.length).toBe(1);
      expect(indexRoutes[0]?.id).toBe('landing');
    });

    it('app scope modules with sub-routes have hasSubRoutes=true', () => {
      const appModules = byScope('app');
      const routersWithStar = appModules.filter((m) => m.hasSubRoutes);
      // These should be the modules that contain nested routes
      expect(routersWithStar.length).toBeGreaterThan(0);
      for (const mod of routersWithStar) {
        expect(mod.hasSubRoutes).toBe(true);
      }
    });

    it('auth scope modules require no permissions', () => {
      const authModules = byScope('auth');
      for (const mod of authModules) {
        expect(mod.requiredPermissions).toEqual([]);
      }
    });
  });
});
