/**
 * PRC-H051: liveness/readiness HTTP probe for the exam-document worker.
 *
 * The worker is a queue consumer with no request surface, but k8s/helm and
 * docker-compose need a probe. Readiness is tied to the actual worker state
 * (running) and broker connectivity (queue.isConnected()), so a disconnected
 * broker fails readiness rather than reporting healthy.
 *
 * Uses only the Node http module — no extra runtime dependency.
 */
import { createServer, type Server } from 'node:http';

export interface HealthProbeTarget {
  /** True once the consumer loop is active. */
  readonly running: boolean;
  /** True while the broker connection is up. */
  isConnected(): boolean;
}

export interface HealthServerOptions {
  worker: HealthProbeTarget;
  port?: number;
  host?: string;
}

export interface HealthServerHandle {
  readonly server: Server;
  close(): Promise<void>;
}

/**
 * Compute the readiness decision for the worker. Pure for unit testing.
 */
export function computeReadiness(worker: HealthProbeTarget): {
  ready: boolean;
  reason: string;
} {
  if (!worker.running) {
    return { ready: false, reason: 'worker-not-running' };
  }
  if (!worker.isConnected()) {
    return { ready: false, reason: 'broker-disconnected' };
  }
  return { ready: true, reason: 'ok' };
}

/**
 * Start the health server. Resolves once listening.
 */
export function startHealthServer(options: HealthServerOptions): Promise<HealthServerHandle> {
  const port = options.port ?? Number(process.env['EXAM_DOCUMENT_WORKER_PORT'] ?? '3025');
  const host = options.host ?? process.env['EXAM_DOCUMENT_WORKER_HOST'] ?? '0.0.0.0';

  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/health/live') {
      // Liveness: the process is up and the event loop is serving requests.
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'alive' }));
      return;
    }
    if (url === '/health/ready' || url === '/health') {
      const { ready, reason } = computeReadiness(options.worker);
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: ready ? 'ready' : 'not-ready', reason }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'not-found' }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve({
        server,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
