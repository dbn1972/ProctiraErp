/**
 * Smoke test for the federated feature registry.
 *
 * Asserts that every registry entry resolves to a real component import path
 * by calling each lazyImport function and verifying it returns a module with
 * a default export (React component).
 */
import { describe, it, expect } from 'vitest';
import { featureRegistry, getModulesByScope, getModuleById, getFeatureChunkIds } from './featureRegistry';
import type { FeatureModule, VisibilityScope } from './featureRegistry';

describe('featureRegistry', () => {
  it('should have at least one module per scope', () => {
    const scopes: VisibilityScope[] = ['public', 'auth', 'app', 'mobile'];
    for (const scope of scopes) {
      const modules = getModulesByScope(scope);
      expect(modules.length).toBeGreaterThan(0);
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

  describe('lazy imports resolve to real component modules', () => {
    // Test each registry entry individually so failures are easy to identify
    for (const mod of featureRegistry) {
      it(`${mod.id} (${mod.scope}) resolves to a module with default export`, async () => {
        const module = await mod.lazyImport();
        expect(module).toBeDefined();
        expect(module.default).toBeDefined();
        expect(typeof module.default).toBe('function');
      });
    }
  });

  describe('getModulesByScope', () => {
    it('returns only public modules for public scope', () => {
      const modules = getModulesByScope('public');
      expect(modules.every((m) => m.scope === 'public')).toBe(true);
    });

    it('returns only auth modules for auth scope', () => {
      const modules = getModulesByScope('auth');
      expect(modules.every((m) => m.scope === 'auth')).toBe(true);
    });

    it('returns only app modules for app scope', () => {
      const modules = getModulesByScope('app');
      expect(modules.every((m) => m.scope === 'app')).toBe(true);
    });

    it('returns only mobile modules for mobile scope', () => {
      const modules = getModulesByScope('mobile');
      expect(modules.every((m) => m.scope === 'mobile')).toBe(true);
    });
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

  describe('getFeatureChunkIds', () => {
    it('returns an array of all feature IDs', () => {
      const ids = getFeatureChunkIds();
      expect(ids.length).toBe(featureRegistry.length);
      expect(ids).toContain('dashboard');
      expect(ids).toContain('institutions');
      expect(ids).toContain('students');
    });
  });

  describe('route structure integrity', () => {
    it('public scope has exactly one index route', () => {
      const publicModules = getModulesByScope('public');
      const indexRoutes = publicModules.filter((m) => m.isIndex);
      expect(indexRoutes.length).toBe(1);
      expect(indexRoutes[0]?.id).toBe('landing');
    });

    it('app scope modules with sub-routes have hasSubRoutes=true', () => {
      const appModules = getModulesByScope('app');
      const routersWithStar = appModules.filter((m) => m.hasSubRoutes);
      // These should be the modules that contain nested routes
      expect(routersWithStar.length).toBeGreaterThan(0);
      for (const mod of routersWithStar) {
        expect(mod.hasSubRoutes).toBe(true);
      }
    });

    it('auth scope modules require no permissions', () => {
      const authModules = getModulesByScope('auth');
      for (const mod of authModules) {
        expect(mod.requiredPermissions).toEqual([]);
      }
    });
  });
});
