/**
 * System health dashboard API client.
 *
 * Pulls adapter status, queue lag, and error rates from the observability
 * service. Returns deterministic stub data when the gateway is unavailable.
 */
import { gatewayFetch } from './gateway';

export type HealthStatus = 'healthy' | 'degraded' | 'down';

export interface AdapterHealth {
  name: string;
  category: 'queue' | 'cache' | 'storage' | 'auth' | 'database' | 'external';
  status: HealthStatus;
  latencyMs: number;
  /** Human-readable note (last error, lag value, etc.). */
  note: string;
  lastChecked: string;
}

export interface QueueLag {
  queue: string;
  depth: number;
  ageSeconds: number;
  consumerCount: number;
}

export interface ErrorRate {
  service: string;
  /** Errors per million requests over the last 5 minutes. */
  errorPerMillion: number;
  status: HealthStatus;
}

export interface SystemHealth {
  adapters: AdapterHealth[];
  queues: QueueLag[];
  errors: ErrorRate[];
  /** Timestamp of the snapshot. */
  generatedAt: string;
}

const STUB_HEALTH: SystemHealth = {
  generatedAt: new Date().toISOString(),
  adapters: [
    {
      name: 'PostgreSQL',
      category: 'database',
      status: 'healthy',
      latencyMs: 12,
      note: 'Replicas in sync (lag < 1s)',
      lastChecked: new Date().toISOString(),
    },
    {
      name: 'Redis Cache',
      category: 'cache',
      status: 'healthy',
      latencyMs: 1,
      note: 'Hit rate 92%',
      lastChecked: new Date().toISOString(),
    },
    {
      name: 'Object Storage',
      category: 'storage',
      status: 'healthy',
      latencyMs: 28,
      note: 'All regions reachable',
      lastChecked: new Date().toISOString(),
    },
    {
      name: 'Queue (RabbitMQ)',
      category: 'queue',
      status: 'degraded',
      latencyMs: 220,
      note: 'Backlog of 1.4k events on attendance.events',
      lastChecked: new Date().toISOString(),
    },
    {
      name: 'Auth Service',
      category: 'auth',
      status: 'healthy',
      latencyMs: 35,
      note: 'JWT issuance OK',
      lastChecked: new Date().toISOString(),
    },
    {
      name: 'External SMS Gateway',
      category: 'external',
      status: 'down',
      latencyMs: 0,
      note: 'Vendor outage — incident OEM-1421 open',
      lastChecked: new Date().toISOString(),
    },
  ],
  queues: [
    { queue: 'student.events', depth: 12, ageSeconds: 3, consumerCount: 4 },
    { queue: 'attendance.events', depth: 1421, ageSeconds: 95, consumerCount: 4 },
    { queue: 'audit.events', depth: 0, ageSeconds: 0, consumerCount: 2 },
    { queue: 'notification.dispatch', depth: 80, ageSeconds: 18, consumerCount: 3 },
  ],
  errors: [
    { service: 'tenant-service', errorPerMillion: 12, status: 'healthy' },
    { service: 'student-service', errorPerMillion: 38, status: 'healthy' },
    { service: 'notification-service', errorPerMillion: 1820, status: 'degraded' },
    { service: 'plugin-service', errorPerMillion: 4, status: 'healthy' },
  ],
};

export async function getSystemHealth(): Promise<{
  health: SystemHealth;
  source: 'gateway' | 'stub';
}> {
  const response = await gatewayFetch<SystemHealth>('/health/system');
  if (response.ok && response.data) {
    return { health: response.data, source: 'gateway' };
  }
  if (response.status > 0) {
    return {
      health: {
        generatedAt: new Date().toISOString(),
        adapters: [],
        queues: [],
        errors: [],
      },
      source: 'gateway',
    };
  }
  return { health: STUB_HEALTH, source: 'stub' };
}
