/**
 * PRC-L142: the registration plugin hands the staff service and the admissions
 * pipeline one CRM store (waitlist enqueue and seat-release promote share a
 * queue) without reaching into RegistrationService's private field.
 *
 * The plugin's module graph (Prisma client, routes, pipeline) is imported
 * statically so it loads during collection. Importing it inside the test body
 * counted the load against the 5 s test timeout, which timed out on loaded CI
 * runners (main CI runs 45414191684, 45444082900, 45460889212).
 */
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import { InMemoryAdmissionsPipelineStore } from './pipeline/pipeline-store.js';
import { registrationPlugin } from './registration-plugin.js';

const captured = vi.hoisted((): { service?: unknown; pipeline?: unknown } => ({}));

vi.mock('./registration-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./registration-service.js')>();
  class CapturingRegistrationService extends actual.RegistrationService {
    constructor(...args: ConstructorParameters<typeof actual.RegistrationService>) {
      super(...args);
      captured.service = args[1];
    }
  }
  return { ...actual, RegistrationService: CapturingRegistrationService };
});

vi.mock('./pipeline/pipeline-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pipeline/pipeline-service.js')>();
  class CapturingPipelineService extends actual.AdmissionsPipelineService {
    constructor(...args: ConstructorParameters<typeof actual.AdmissionsPipelineService>) {
      super(...args);
      captured.pipeline = args[5];
    }
  }
  return { ...actual, AdmissionsPipelineService: CapturingPipelineService };
});

describe('registration plugin CRM sharing (PRC-L142)', () => {
  it('gives the service and the pipeline the same default CRM store', async () => {
    const app = Fastify({ logger: false });
    await app.register(registrationPlugin, {
      repository: new InMemoryRegistrationRepository(),
      pipelineStore: new InMemoryAdmissionsPipelineStore(),
    });
    await app.ready();
    expect(captured.service).toBeDefined();
    expect(captured.pipeline).toBe(captured.service);
    await app.close();
  });
});
