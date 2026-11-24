/**
 * PRC-L142: the registration plugin hands the staff service and the admissions
 * pipeline one CRM store (waitlist enqueue and seat-release promote share a
 * queue) without reaching into RegistrationService's private field.
 */
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const captured: { service?: unknown; pipeline?: unknown } = {};

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
    const { registrationPlugin } = await import('./registration-plugin.js');
    const { InMemoryRegistrationRepository } = await import('./in-memory-repository.js');
    const { InMemoryAdmissionsPipelineStore } = await import('./pipeline/pipeline-store.js');
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
