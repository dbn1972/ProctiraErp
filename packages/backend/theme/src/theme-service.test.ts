/**
 * Theme Service Tests
 *
 * Tests for theme CRUD, publishing, rollback, preview, and accessibility validation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundError, ConflictError, BusinessRuleError } from '@proctira/common';

import { ThemeService } from './theme-service.js';
import { InMemoryThemeRepository } from './in-memory-repository.js';
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
    service = new ThemeService(repository, { enforceAccessibility: true });
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
      await service.update(tenantId, theme.id, { tokens: newTokens });

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
      await service.update(tenantId, theme.id, { tokens: newTokens });
      await service.publish(tenantId, theme.id, { commitMessage: 'v2' }, 'admin');

      // Rollback to revision 1
      const rolledBack = await service.rollback(tenantId, theme.id, {
        revisionId: rev1.id,
        reason: 'Reverting color change',
      });

      expect(rolledBack.tokens.colors.primary).toBe(validTokens().colors.primary);
      expect(rolledBack.currentRevision).toBe(1);
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
      await service.update(tenantId, theme.id, { tokens: newTokens });
      await service.publish(tenantId, theme.id, { commitMessage: 'v2' }, 'admin');

      const revisions = await service.listRevisions(tenantId, theme.id);
      expect(revisions).toHaveLength(2);
      expect(revisions[0]!.revisionNumber).toBe(2);
      expect(revisions[1]!.revisionNumber).toBe(1);
    });
  });
});
