/**
 * Theme Routes Tests
 *
 * Integration tests for theme API routes using Fastify inject.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { ThemeService } from './theme-service.js';
import { InMemoryThemeRepository } from './in-memory-repository.js';
import { registerThemeRoutes } from './routes.js';
import type { ThemeTokens } from './schemas.js';

function validTokens(): ThemeTokens {
  return {
    colors: {
      primary: '#1a56db',
      secondary: '#6b7280',
      background: '#ffffff',
      surface: '#f9fafb',
      error: '#dc2626',
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
    spacing: { unit: 4 },
  };
}

describe('Theme Routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryThemeRepository;
  let themeService: ThemeService;
  const tenantId = 'tenant-001';

  beforeEach(async () => {
    app = Fastify();
    repository = new InMemoryThemeRepository();
    themeService = new ThemeService(repository, { enforceAccessibility: true });

    // Add tenant context decorator
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as any).tenantId = tenantId;
    });

    // Add user decorator
    app.decorateRequest('user', undefined);
    app.addHook('onRequest', async (request) => {
      (request as any).user = { sub: 'admin-user' };
    });

    await registerThemeRoutes(app, { themeService, prefix: '/themes' });
    await app.ready();
  });

  describe('POST /themes', () => {
    it('should create a theme', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/themes',
        payload: {
          name: 'My Theme',
          description: 'A custom theme',
          level: 'tenant',
          tokens: validTokens(),
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.name).toBe('My Theme');
      expect(body.level).toBe('tenant');
      expect(body.status).toBe('draft');
      expect(body.tokens.colors.primary).toBe('#1a56db');
    });

    it('should return 400 for invalid payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/themes',
        payload: {
          // Missing required fields
          name: '',
          level: 'tenant',
          tokens: {},
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /themes', () => {
    it('should list themes', async () => {
      // Create a theme first
      await app.inject({
        method: 'POST',
        url: '/themes',
        payload: {
          name: 'Theme 1',
          level: 'tenant',
          tokens: validTokens(),
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/themes',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.meta.total).toBe(1);
    });
  });

  describe('GET /themes/:themeId', () => {
    it('should get a theme by ID', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/themes',
        payload: {
          name: 'My Theme',
          level: 'tenant',
          tokens: validTokens(),
        },
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'GET',
        url: `/themes/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('My Theme');
    });

    it('should return 404 for non-existent theme', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/themes/00000000-0000-4000-8000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /themes/:themeId', () => {
    it('should update a theme', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/themes',
        payload: {
          name: 'Original',
          level: 'tenant',
          tokens: validTokens(),
        },
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'PUT',
        url: `/themes/${created.id}`,
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Updated');
    });
  });

  describe('POST /themes/:themeId/publish', () => {
    it('should publish a theme and return revision', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/themes',
        payload: {
          name: 'Publishable',
          level: 'tenant',
          tokens: validTokens(),
        },
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'POST',
        url: `/themes/${created.id}/publish`,
        payload: { commitMessage: 'First publish' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.revisionNumber).toBe(1);
      expect(body.commitMessage).toBe('First publish');
      expect(body.publishedBy).toBe('admin-user');
    });
  });

  describe('POST /themes/:themeId/rollback', () => {
    it('should rollback to a previous revision', async () => {
      // Create and publish
      const createResponse = await app.inject({
        method: 'POST',
        url: '/themes',
        payload: {
          name: 'Rollback Test',
          level: 'tenant',
          tokens: validTokens(),
        },
      });
      const created = createResponse.json();

      const publishResponse = await app.inject({
        method: 'POST',
        url: `/themes/${created.id}/publish`,
        payload: {},
      });
      const revision = publishResponse.json();

      // Update and publish again
      const newTokens = validTokens();
      newTokens.colors.primary = '#2563eb';
      await app.inject({
        method: 'PUT',
        url: `/themes/${created.id}`,
        payload: { tokens: newTokens },
      });
      await app.inject({
        method: 'POST',
        url: `/themes/${created.id}/publish`,
        payload: {},
      });

      // Rollback to first revision
      const response = await app.inject({
        method: 'POST',
        url: `/themes/${created.id}/rollback`,
        payload: { revisionId: revision.id },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().tokens.colors.primary).toBe('#1a56db');
    });
  });

  describe('GET /themes/:themeId/preview', () => {
    it('should return preview with accessibility result', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/themes',
        payload: {
          name: 'Preview Test',
          level: 'tenant',
          tokens: validTokens(),
        },
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'GET',
        url: `/themes/${created.id}/preview`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.themeId).toBe(created.id);
      expect(body.accessibilityResult.valid).toBe(true);
    });
  });

  describe('GET /themes/:themeId/revisions', () => {
    it('should list revisions', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/themes',
        payload: {
          name: 'Revisions Test',
          level: 'tenant',
          tokens: validTokens(),
        },
      });
      const created = createResponse.json();

      await app.inject({
        method: 'POST',
        url: `/themes/${created.id}/publish`,
        payload: { commitMessage: 'v1' },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/themes/${created.id}/revisions`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].commitMessage).toBe('v1');
    });
  });

  describe('GET /themes/tokens', () => {
    it('should return effective tokens for tenant', async () => {
      // Create and publish a tenant theme
      const createResponse = await app.inject({
        method: 'POST',
        url: '/themes',
        payload: {
          name: 'Tenant Theme',
          level: 'tenant',
          tokens: validTokens(),
        },
      });
      const created = createResponse.json();

      await app.inject({
        method: 'POST',
        url: `/themes/${created.id}/publish`,
        payload: {},
      });

      const response = await app.inject({
        method: 'GET',
        url: '/themes/tokens',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.tokens.colors.primary).toBe('#1a56db');
    });
  });
});
