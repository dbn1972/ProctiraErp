import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { PrivacyRepository } from './privacy-repository.js';
import { PrivacyService } from './privacy-service.js';

export interface PrivacyPluginOptions { repository: PrivacyRepository; }
declare module 'fastify' { interface FastifyInstance { privacyService: PrivacyService; } }

export const privacyPlugin = fp(async function privacyPluginImpl(fastify: FastifyInstance, options: PrivacyPluginOptions) {
  fastify.decorate('privacyService', new PrivacyService(options.repository));
}, { name: '@proctira/backend-privacy', fastify: '5.x', dependencies: [] });
