import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { HostelFeesPort } from './fees-ledger-port.js';
import type { HostelRepository } from './hostel-repository.js';
import { HostelService } from './hostel-service.js';
import { registerHostelRoutes } from './routes.js';

export interface HostelPluginOptions {
  repository: HostelRepository;
  feesLedger?: HostelFeesPort | null;
  prefix?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    hostelService: HostelService;
  }
}

export const hostelPlugin = fp(
  async function hostelPluginImpl(fastify: FastifyInstance, options: HostelPluginOptions) {
    const { repository, feesLedger = null, prefix = '/hostel' } = options;
    const hostelService = new HostelService(repository, feesLedger);
    fastify.decorate('hostelService', hostelService);
    await registerHostelRoutes(fastify, { hostelService, prefix });
  },
  {
    name: '@proctira/backend-hostel',
    fastify: '5.x',
    dependencies: [],
  },
);
