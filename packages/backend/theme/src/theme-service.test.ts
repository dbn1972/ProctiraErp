/**
 * Theme Service Tests
 *
 * Tests for theme CRUD, publishing, rollback, preview, and accessibility validation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundError, ConflictError, BusinessRuleError, ForbiddenError } from '@proctira/common';

import { ThemeService, PLATFORM_THEME_TENANT_ID } from './theme-service.js';
import { InMemoryThemeRepository } from './in-memory-repository.js';
import { ThemeRevisionConflictError } from './theme-repository.js';
import type { CreateThemeInput, ThemeTokens } from './schemas.js';

/**
 * Create valid theme tokens that pass accessibility checks.
 */
function validTokens(): ThemeTokens {
  return {
    colors: {
      primary: '#1a56db',
      secondary: '#6b7280',
      background: '#ffffff',
      surface: '#f9fafb',
      error: '#dc2626',
      warning: '#f59e0b',
      success: '#16a34a',
      textPrimary: '#111827',
      textSecondary: '#4b5563',
      onPrimary: '#ffffff',
      onSecondary: '#ffffff',
      onError: '#ffffff',
    },
    typography: {
      fontFamily: 'Inter, sans-serif',
      baseFontSize: 16,
      lineHeight: 1.5,
    },
    spacing: {
      unit: 4,
      scale: [0, 1, 2, 4, 6, 8, 12, 16, 24, 32],
    },
    borderRadius: {
      sm: '2px',
      md: '4px',
      lg: '8px',
      full: '9999px',
    },
    shadows: {
      sm: '0 1px 2px rgba(0,0,0,0.05)',
      md: '0 4px 6px rgba(0,0,0,0.1)',
      lg: '0 10px 15px rgba(0,0,0,0.1)',
    },
    darkMode: false,
  };
}

/**
 * Create a valid CreateThemeInput.
 */
function validCreateInput(overrides?: Partial<CreateThemeInput>): CreateThemeInput {
  return {
    name: 'Test Theme',
    description: 'A test theme',
    level: 'tenant',
    tokens: validTokens(),
    ...overrides,
  };
}

describe('ThemeService', () => {
  let repository: InMemoryThemeRepository;
  let service: ThemeService;
  const tenantId = 'tenant-001';

  beforeEach(() => {
    repository = new InMemoryThemeRepository();
    service = new ThemeService(repository, {
      enforceAccessibility: true,
      portalExists: async () => true,
    });
  });

  describe('platform level (PRC-M395)', () => {
    it('rejects a tenant user creating a platform-level theme', async () => {
      await expect(
        service.create(tenantId, validCreateInput({ level: 'platform' })),
      ).rejects.toThrow(ForbiddenError);
    });

    it('stores platform themes under the reserved platform owner, not the tenant', async () => {
      const theme = await service.create(tenantId, validCreateInput({ level: 'platform' }), {
        isPlatformAdmin: true,
      });
      expect(theme.tenantId).toBe(PLATFORM_THEME_TENANT_ID);
      await expect(service.getById(tenantId, theme.id)).rejects.toThrow(NotFoundError);
      await expect(
        service.getById(tenantId, theme.id, { isPlatformAdmin: true }),
      ).resolves.toMatchObject({ id: theme.id });
    });

    it('#555 review #10: platform themes use the platform-scope repository path only', async () => {
      const createPlatformTheme = vi.spyOn(repository, 'createPlatformTheme');
      const byTenant = vi.spyOn(repository, 'findThemeByTenantAndLevel');
      const theme = await service.create(tenantId, validCreateInput({ level: 'platform' }), {
        isPlatformAdmin: true,
      });
      await service.publish(tenantId, theme.id, {}, 'root', { isPlatformAdmin: true });
      await service.getTokens('tenant-xyz');
      expect(createPlatformTheme).toHaveBeenCalledTimes(1);
      expect(byTenant.mock.calls.some(([owner]) => owner === PLATFORM_THEME_TENANT_ID)).toBe(false);
    });

    it('does not serve a draft platform theme', async () => {
      await service.create(tenantId, validCreateInput({ level: 'platform' }), {
        isPlatformAdmin: true,
      });
      await expect(service.getTokens('tenant-xyz')).rejects.toThrow(NotFoundError);
    });

    it('serves the published platform theme to every tenant', async () => {
      const theme = await service.create(tenantId, validCreateInput({ level: 'platform' }), {
        isPlatformAdmin: true,
      });
      await service.publish(tenantId, theme.id, {}, 'root', { isPlatformAdmin: true });
      const tokens = await service.getTokens('tenant-xyz');
      expect(tokens.colors.primary).toBe(validTokens().colors.primary);
    });

    it('rejects portal themes for unknown portals and fails closed without a resolver', async () => {
      const portalId = '22222222-2222-4222-8222-222222222222';
      const strict = new ThemeService(repository, { portalExists: async () => false });
      await expect(
        strict.create(tenantId, validCreateInput({ level: 'portal', portalId })),
      ).rejects.toThrow(NotFoundError);
      const unconfigured = new ThemeService(repository);
      await expect(
        unconfigured.create(tenantId, validCreateInput({ level: 'portal', portalId })),
      ).rejects.toThrow(BusinessRuleError);
    });
  });

  describe('create', () => {
    it('should create a theme with valid tokens', async () => {
      const input = validCreateInput();
      const theme = await service.create(tenantId, input);

      expect(theme.id).toBeDefined();
      expect(theme.tenantId).toBe(tenantId);
      expect(theme.name).toBe('Test Theme');
      expect(theme.level).toBe('tenant');
      expect(theme.status).toBe('draft');
      expect(theme.tokens).toEqual(input.tokens);
      expect(theme.currentRevision).toBeNull();
    });

    it('should reject portal-level theme without portalId', async () => {
      const input = validCreateInput({ level: 'portal' });

      await expect(service.create(tenantId, input)).rejects.toThrow(BusinessRuleError);
    });

    it('should create portal-level theme with portalId', async () => {
      const input = validCreateInput({
        level: 'portal',
        portalId: '12345678-1234-4123-8123-123456789abc',
      });
      const theme = await service.create(tenantId, input);

      expect(theme.level).toBe('portal');
      expect(theme.portalId).toBe('12345678-1234-4123-8123-123456789abc');
    });

    it('should reject duplicate theme at same level', async () => {
      const input = validCreateInput();
      await service.create(tenantId, input);

      await expect(service.create(tenantId, input)).rejects.toThrow(ConflictError);
    });

    it('should reject theme with inaccessible font size', async () => {
      const tokens = validTokens();
      tokens.typography.baseFontSize = 10; // Below 12px minimum
      const input = validCreateInput({ tokens });

      await expect(service.create(tenantId, input)).rejects.toThrow(BusinessRuleError);
    });

    it('should allow inaccessible theme when enforcement is disabled', async () => {
      const lenientService = new ThemeService(repository, { enforceAccessibility: false });
      const tokens = validTokens();
      tokens.typography.baseFontSize = 10;
      const input = validCreateInput({ tokens });

      const theme = await lenientService.create(tenantId, input);
      expect(theme.tokens.typography.baseFontSize).toBe(10);
    });
  });

  describe('update', () => {
    it('should update theme name', async () => {
      const theme = await service.create(tenantId, validCreateInput());
      const updated = await service.update(tenantId, theme.id, { name: 'Updated Theme' });

      expect(updated.name).toBe('Updated Theme');
    });

    it('should update theme tokens', async () => {
      const theme = await service.create(tenantId, validCreateInput());
      const newTokens = validTokens();
      newTokens.colors.primary = '#2563eb';

      const updated = await service.update(tenantId, theme.id, { tokens: newTokens });
      expect(updated.tokens.colors.primary).toBe('#2563eb');
    });

    it('should reject update with inaccessible tokens', async () => {
      const theme = await service.create(tenantId, validCreateInput());
      const badTokens = validTokens();
      badTokens.typography.baseFontSize = 8;

      await expect(service.update(tenantId, theme.id, { tokens: badTokens })).rejects.toThrow(
        BusinessRuleError,
      );
    });

    it('should reject update for wrong tenant', async () => {
      const theme = await service.create(tenantId, validCreateInput());

      await expect(service.update('other-tenant', theme.id, { name: 'Hacked' })).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('publish', () => {
    it('should publish a theme and create a revision', async () => {
      const theme = await service.create(tenantId, validCreateInput());
      const revision = await service.publish(
        tenantId,
        theme.id,
        { commitMessage: 'Initial release' },
        'admin',
      );

      expect(revision.revisionNumber).toBe(1);
      expect(revision.themeId).toBe(theme.id);
      expect(revision.commitMessage).toBe('Initial release');
      expect(revision.publishedBy).toBe('admin');
      expect(revision.tokens).toEqual(theme.tokens);
    });

    it('should increment revision number on subsequent publishes', async () => {
      const theme = await service.create(tenantId, validCreateInput());

      const rev1 = await service.publish(tenantId, theme.id, {}, 'admin');
      expect(rev1.revisionNumber).toBe(1);

      // Update tokens and publish again
      const newTokens = validTokens();
      newTokens.colors.primary = '#2563eb';
      await repository.updateTheme(theme.id, { tokens: newTokens });

      const rev2 = await service.publish(
        tenantId,
        theme.id,
        { commitMessage: 'Color update' },
        'admin',
      );
      expect(rev2.revisionNumber).toBe(2);
    });

    it('should update theme status to published', async () => {
      const theme = await service.create(tenantId, validCreateInput());
      await service.publish(tenantId, theme.id, {}, 'admin');

      const updated = await service.getById(tenantId, theme.id);
      expect(updated.status).toBe('published');
      expect(updated.currentRevision).toBe(1);
    });

    it('should reject publish with accessibility errors', async () => {
      // Create with enforcement disabled, then try to publish
      const lenientService = new ThemeService(repository, { enforceAccessibility: false });
      const tokens = validTokens();
      tokens.typography.baseFontSize = 10;
      const theme = await lenientService.create(tenantId, validCreateInput({ tokens }));

      // Publishing always validates accessibility
      await expect(lenientService.publish(tenantId, theme.id, {}, 'admin')).rejects.toThrow(
        BusinessRuleError,
      );
    });
  });

  describe('rollback', () => {
    it('should rollback to a previous revision', async () => {
      const theme = await service.create(tenantId, validCreateInput());
      const rev1 = await service.publish(tenantId, theme.id, { commitMessage: 'v1' }, 'admin');

      // Update and publish again
      const newTokens = validTokens();
      newTokens.colors.primary = '#2563eb';
      await repository.updateTheme(theme.id, { tokens: newTokens });
      await service.publish(tenantId, theme.id, { commitMessage: 'v2' }, 'admin');

      // Rollback to revision 1
      const rolledBack = await service.rollback(tenantId, theme.id, {
        revisionId: rev1.id,
        reason: 'Reverting color change',
      });

      expect(rolledBack.tokens.colors.primary).toBe(validTokens().colors.primary);
      // PRC-M392: rollback is recorded as a new revision (N+1)
      expect(rolledBack.currentRevision).toBe(3);
      expect(rolledBack.status).toBe('published');
      const revisions = await service.listRevisions(tenantId, theme.id);
      expect(revisions).toHaveLength(3);
      const rev3 = revisions.find((r) => r.revisionNumber === 3);
      expect(rev3?.commitMessage).toBe('Rollback to revision 1: Reverting color change');
      expect(rev3?.publishedBy).toBe('system');
    });

    it('PRC-M392: rejects update of a published theme with 409 ConflictError', async () => {
      const theme = await service.create(tenantId, validCreateInput());
      await service.publish(tenantId, theme.id, {}, 'admin');
      await expect(service.update(tenantId, theme.id, { name: 'Live edit' })).rejects.toThrow(
        ConflictError,
      );
    });

    it('PRC-M392: rollback re-validates accessibility of the target revision', async () => {
      const theme = await service.create(tenantId, validCreateInput());
      const bad = validTokens();
      bad.typography.baseFontSize = 10;
      await repository.createRevision({
        id: '11111111-1111-4111-8111-111111111111',
        themeId: theme.id,
        revisionNumber: 1,
        tokens: bad,
        assets: null,
        commitMessage: 'legacy',
        publishedBy: 'admin',
        publishedAt: new Date(),
      });
      await expect(
        service.rollback(tenantId, theme.id, {
          revisionId: '11111111-1111-4111-8111-111111111111',
        }),
      ).rejects.toThrow(BusinessRuleError);
      expect(await repository.getLatestRevisionNumber(theme.id)).toBe(1);
    });

    it('#555 review #13: rollback does not resurrect an archived theme', async () => {
      const theme = await service.create(tenantId, validCreateInput());
      const rev1 = await service.publish(tenantId, theme.id, {}, 'admin');
      await repository.updateTheme(theme.id, { status: 'archived' });
      await expect(service.rollback(tenantId, theme.id, { revisionId: rev1.id })).rejects.toThrow(
        ConflictError,
      );
      const after = await service.getById(tenantId, theme.id);
      expect(after.status).toBe('archived');
      expect(await repository.getLatestRevisionNumber(theme.id)).toBe(1);
      await expect(service.publish(tenantId, theme.id, {}, 'admin')).rejects.toThrow(ConflictError);
    });

    it('#555 review #12: concurrent rollbacks commit exactly one revision N+1', async () => {
      const theme = await service.create(tenantId, validCreateInput());
      const rev1 = await service.publish(tenantId, theme.id, {}, 'admin');
      const results = await Promise.allSettled([
        service.rollback(tenantId, theme.id, { revisionId: rev1.id }),
        service.rollback(tenantId, theme.id, { revisionId: rev1.id }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictError);
      const revisions = await service.listRevisions(tenantId, theme.id);
      expect(revisions.map((r) => r.revisionNumber)).toEqual([2, 1]);
      expect((await service.getById(tenantId, theme.id)).currentRevision).toBe(2);
    });

    it('#555 review #12: a rejected commit writes neither the revision nor the theme', async () => {
      const theme = await service.create(tenantId, validCreateInput());
      await repository.updateTheme(theme.id, { status: 'archived' });
      await expect(
        repository.commitRevision(
          {
            id: '33333333-3333-4333-8333-333333333333',
            themeId: theme.id,
            revisionNumber: 1,
            tokens: validTokens(),
            assets: null,
            commitMessage: null,
            publishedBy: 'admin',
            publishedAt: new Date(),
          },
          { status: 'published', currentRevision: 1 },
          { requireStatusIn: ['draft', 'published'] },
        ),
      ).rejects.toThrow(ThemeRevisionConflictError);
      expect(await repository.findRevisionById('33333333-3333-4333-8333-333333333333')).toBeNull();
      expect((await repository.findThemeById(theme.id))?.status).toBe('archived');
    });

    it('should reject rollback to non-existent revision', async () => {
      const theme = await service.create(tenantId, validCreateInput());

      await expect(
        service.rollback(tenantId, theme.id, {
          revisionId: '00000000-0000-4000-8000-000000000000',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('preview', () => {
    it('should return theme preview with accessibility result', async () => {
      const theme = await service.create(tenantId, validCreateInput());
      const preview = await service.preview(tenantId, theme.id);

      expect(preview.themeId).toBe(theme.id);
      expect(preview.tokens).toEqual(theme.tokens);
      expect(preview.accessibilityResult).toBeDefined();
      expect(preview.accessibilityResult.valid).toBe(true);
    });

    it('should report accessibility issues in preview', async () => {
      const lenientService = new ThemeService(repository, { enforceAccessibility: false });
      const tokens = validTokens();
      tokens.typography.baseFontSize = 10;
      const theme = await lenientService.create(tenantId, validCreateInput({ tokens }));

      const preview = await lenientService.preview(tenantId, theme.id);
      expect(preview.accessibilityResult.valid).toBe(false);
      expect(preview.accessibilityResult.issues.length).toBeGreaterThan(0);
    });
  });

  describe('getTokens (inheritance)', () => {
    it('should return tenant theme tokens', async () => {
      const input = validCreateInput({ level: 'tenant' });
      const theme = await service.create(tenantId, input);
      await service.publish(tenantId, theme.id, {}, 'admin');

      const tokens = await service.getTokens(tenantId);
      expect(tokens.colors.primary).toBe(input.tokens.colors.primary);
    });

    it('should merge portal tokens over tenant tokens', async () => {
      // Create and publish tenant theme
      const tenantInput = validCreateInput({ level: 'tenant' });
      const tenantTheme = await service.create(tenantId, tenantInput);
      await service.publish(tenantId, tenantTheme.id, {}, 'admin');

      // Create and publish portal theme with different primary color
      const portalId = '12345678-1234-4123-8123-123456789abc';
      const portalTokens = validTokens();
      portalTokens.colors.primary = '#dc2626';
      const portalInput = validCreateInput({
        name: 'Portal Theme',
        level: 'portal',
        portalId,
        tokens: portalTokens,
      });
      const portalTheme = await service.create(tenantId, portalInput);
      await service.publish(tenantId, portalTheme.id, {}, 'admin');

      // Get tokens with portal override
      const tokens = await service.getTokens(tenantId, portalId);
      expect(tokens.colors.primary).toBe('#dc2626');
      // Other tokens should come from tenant theme
      expect(tokens.typography.fontFamily).toBe('Inter, sans-serif');
    });

    it('should throw when no theme exists', async () => {
      await expect(service.getTokens('no-tenant')).rejects.toThrow(NotFoundError);
    });
  });

  describe('listRevisions', () => {
    it('should list revisions in descending order', async () => {
      const theme = await service.create(tenantId, validCreateInput());
      await service.publish(tenantId, theme.id, { commitMessage: 'v1' }, 'admin');

      const newTokens = validTokens();
      newTokens.colors.primary = '#2563eb';
      await repository.updateTheme(theme.id, { tokens: newTokens });
      await service.publish(tenantId, theme.id, { commitMessage: 'v2' }, 'admin');

      const revisions = await service.listRevisions(tenantId, theme.id);
      expect(revisions).toHaveLength(2);
      expect(revisions[0]!.revisionNumber).toBe(2);
      expect(revisions[1]!.revisionNumber).toBe(1);
    });
  });
});
