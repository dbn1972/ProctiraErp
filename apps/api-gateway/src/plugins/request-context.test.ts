import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import requestContextPlugin from './request-context.js';

describe('requestContextPlugin', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await app.register(requestContextPlugin);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Request ID generation', () => {
    it('should generate a UUID request ID when no header is provided', async () => {
      app.get('/test', async (request) => {
        return { requestId: request.requestId };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      const body = response.json();
      expect(body.requestId).toBeDefined();
      expect(body.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('should preserve incoming X-Request-ID header', async () => {
      const customRequestId = 'custom-request-id-123';

      app.get('/test', async (request) => {
        return { requestId: request.requestId };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-request-id': customRequestId },
      });

      const body = response.json();
      expect(body.requestId).toBe(customRequestId);
    });

    it('should set X-Request-ID response header', async () => {
      app.get('/test', async () => {
        return { ok: true };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      const responseRequestId = response.headers['x-request-id'];
      expect(responseRequestId).toBeDefined();
      expect(typeof responseRequestId).toBe('string');
      expect((responseRequestId as string).length).toBeGreaterThan(0);
    });

    it('should echo back the provided X-Request-ID in response', async () => {
      const customRequestId = 'echo-me-back-456';

      app.get('/test', async () => {
        return { ok: true };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-request-id': customRequestId },
      });

      expect(response.headers['x-request-id']).toBe(customRequestId);
    });
  });

  describe('Correlation ID propagation', () => {
    it('should generate a UUID correlation ID when no header is provided', async () => {
      app.get('/test', async (request) => {
        return { correlationId: request.correlationId };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      const body = response.json();
      expect(body.correlationId).toBeDefined();
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('should propagate incoming X-Correlation-ID header', async () => {
      const customCorrelationId = 'trace-abc-789';

      app.get('/test', async (request) => {
        return { correlationId: request.correlationId };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-correlation-id': customCorrelationId },
      });

      const body = response.json();
      expect(body.correlationId).toBe(customCorrelationId);
    });

    it('should set X-Correlation-ID response header', async () => {
      app.get('/test', async () => {
        return { ok: true };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      const responseCorrelationId = response.headers['x-correlation-id'];
      expect(responseCorrelationId).toBeDefined();
      expect(typeof responseCorrelationId).toBe('string');
      expect((responseCorrelationId as string).length).toBeGreaterThan(0);
    });

    it('should echo back the provided X-Correlation-ID in response', async () => {
      const customCorrelationId = 'propagate-this-id';

      app.get('/test', async () => {
        return { ok: true };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-correlation-id': customCorrelationId },
      });

      expect(response.headers['x-correlation-id']).toBe(customCorrelationId);
    });
  });

  describe('Request and Correlation IDs are independent', () => {
    it('should generate different IDs for request and correlation when neither is provided', async () => {
      app.get('/test', async (request) => {
        return {
          requestId: request.requestId,
          correlationId: request.correlationId,
        };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      const body = response.json();
      expect(body.requestId).not.toBe(body.correlationId);
    });

    it('should allow setting request ID without affecting correlation ID', async () => {
      const customRequestId = 'only-request-id';

      app.get('/test', async (request) => {
        return {
          requestId: request.requestId,
          correlationId: request.correlationId,
        };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-request-id': customRequestId },
      });

      const body = response.json();
      expect(body.requestId).toBe(customRequestId);
      expect(body.correlationId).not.toBe(customRequestId);
      // Correlation ID should be a generated UUID
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });
  });

  describe('Custom header names', () => {
    it('should support custom request ID header name', async () => {
      const customApp = Fastify();
      await customApp.register(requestContextPlugin, {
        requestIdHeader: 'x-custom-request-id',
      });

      customApp.get('/test', async (request) => {
        return { requestId: request.requestId };
      });

      const response = await customApp.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-custom-request-id': 'custom-header-value' },
      });

      const body = response.json();
      expect(body.requestId).toBe('custom-header-value');

      await customApp.close();
    });

    it('should support custom correlation ID header name', async () => {
      const customApp = Fastify();
      await customApp.register(requestContextPlugin, {
        correlationIdHeader: 'x-trace-id',
      });

      customApp.get('/test', async (request) => {
        return { correlationId: request.correlationId };
      });

      const response = await customApp.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-trace-id': 'trace-value-123' },
      });

      const body = response.json();
      expect(body.correlationId).toBe('trace-value-123');

      await customApp.close();
    });
  });

  describe('Multiple requests', () => {
    it('should generate unique request IDs for each request', async () => {
      app.get('/test', async (request) => {
        return { requestId: request.requestId };
      });

      const response1 = await app.inject({ method: 'GET', url: '/test' });
      const response2 = await app.inject({ method: 'GET', url: '/test' });

      const body1 = response1.json();
      const body2 = response2.json();
      expect(body1.requestId).not.toBe(body2.requestId);
    });
  });
});
