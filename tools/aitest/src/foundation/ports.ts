/**
 * Loopback port blocks for aitest units (program CONVENTIONS section 1).
 *
 * Every unit owns one 50-port block; services sit at fixed offsets inside it
 * (program plan section 3), so two units never collide and a port number
 * tells you which unit and service it belongs to.
 */
import { run } from './exec.js';

export const UNIT_PORT_BASES: Readonly<Record<string, number>> = Object.freeze({
  't01-permission-matrix': 34000,
  't02-cross-tenant-idor': 34050,
  't03-property-invariants': 34100,
  't04-model-based-workflows': 34150,
  't05-concurrency-races': 34200,
  't06-compressed-year': 34250,
  't08-resilience-recovery': 34350,
  't09-security-probing': 34400,
  't10-personal-data-flow': 34450,
  't11-accessibility': 34500,
  't12-persona-uat': 34550,
  't13-statutory-reports': 34600,
  't14-mutation-testing': 34650,
  'fix-security': 34700,
  'fix-money-grades': 34750,
  'fix-other': 34800,
  restore: 34850,
  wave1: 34900,
  wave2: 34900,
  wave3: 34900,
  wave4: 34900,
  foundation: 34950,
});

export const PORT_OFFSETS = Object.freeze({
  postgres: 0,
  redis: 1,
  kafka: 2,
  rabbitmq: 3,
  rabbitmqMgmt: 4,
  minio: 5,
  minioConsole: 6,
  keycloak: 7,
  gateway: 10,
  gateway2: 11,
  etlWorker: 12,
  examDocumentWorker: 13,
  web: 20,
  registrationPortal: 21,
  publicWebsite: 22,
  adminConsole: 23,
  developerPortal: 24,
  installWizard: 25,
  trackLocal: 30,
} as const);

export type PortName = keyof typeof PORT_OFFSETS;
export type PortMap = { [K in PortName]: number };

export const PORT_BLOCK_SIZE = 50;
/** Program range (BRIEF): loopback 34000-34999 only. */
export const PORT_RANGE = Object.freeze({ min: 34000, max: 34999 });

export const PROJECT_RE = /^proctira-aitest-[a-z0-9-]+$/;

export function portsFor(base: number): PortMap {
  if (!Number.isInteger(base) || base % PORT_BLOCK_SIZE !== 0) {
    throw new Error(`port base must be a multiple of ${PORT_BLOCK_SIZE}, got ${String(base)}`);
  }
  if (base < PORT_RANGE.min || base + PORT_BLOCK_SIZE - 1 > PORT_RANGE.max) {
    throw new Error(
      `port base ${base} is outside the program range ${PORT_RANGE.min}-${PORT_RANGE.max}`,
    );
  }
  const out = {} as PortMap;
  for (const [name, offset] of Object.entries(PORT_OFFSETS) as Array<[PortName, number]>) {
    out[name] = base + offset;
  }
  return out;
}

export function resolveUnit(
  unit: string,
  o: { portBase?: number; project?: string } = {},
): { unit: string; project: string; portBase: number } {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(unit)) {
    throw new Error(`unit must be lowercase letters, digits and '-', got ${JSON.stringify(unit)}`);
  }
  const known = UNIT_PORT_BASES[unit];
  const portBase = o.portBase ?? known;
  if (portBase === undefined) {
    throw new Error(
      `unknown unit ${unit}: pass --port-base (known units: ${Object.keys(UNIT_PORT_BASES).join(', ')})`,
    );
  }
  portsFor(portBase);
  const project = o.project ?? `proctira-aitest-${unit}`;
  if (!PROJECT_RE.test(project)) {
    throw new Error(`compose project must match ${String(PROJECT_RE)}, got ${project}`);
  }
  return { unit, project, portBase };
}

export interface Listener {
  port: number;
  address: string;
  /** ss state column (LISTEN, ESTAB, TIME-WAIT, ...). */
  state?: string;
  process?: string;
}

/** Parses `ss -ltnpH` output into listeners (process is present only for own processes). */
export function parseListeners(ssOutput: string): Listener[] {
  const out: Listener[] = [];
  for (const line of ssOutput.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const local = cols[3] ?? '';
    const idx = local.lastIndexOf(':');
    if (idx < 0) continue;
    const port = Number(local.slice(idx + 1));
    if (!Number.isInteger(port)) continue;
    const proc = /users:\(\("([^"]+)",pid=(\d+)/.exec(line);
    out.push({
      port,
      address: local.slice(0, idx),
      ...(cols[0] && cols[0] !== 'LISTEN' ? { state: cols[0] } : {}),
      ...(proc ? { process: `${proc[1] ?? '?'} pid ${proc[2] ?? '?'}` } : {}),
    });
  }
  return out;
}

/**
 * Ports of `ports` that any local TCP socket uses, in any state. The program
 * range 34000-34999 sits inside Linux's default ephemeral range
 * (32768-60999), so an outgoing connection can briefly hold a block port as
 * its source port and make listen()/docker publish fail with EADDRINUSE.
 */
export async function boundPorts(
  ports: number[],
  o: { listSockets?: () => Promise<string> } = {},
): Promise<number[]> {
  const list =
    o.listSockets ??
    (async () => {
      const r = await run('ss', ['-tanH']);
      if (r.code !== 0) throw new Error(`ss -tanH failed: ${r.stderr.trim()}`);
      return r.stdout;
    });
  const wanted = new Set(ports);
  // TIME-WAIT does not block a bind: listeners set SO_REUSEADDR.
  const held = parseListeners(await list()).filter((l) => l.state !== 'TIME-WAIT');
  return [...new Set(held.map((l) => l.port))].filter((p) => wanted.has(p)).sort();
}

/** Waits until no socket holds any of `ports` (ephemeral source ports clear quickly). */
export async function waitPortsUnbound(
  ports: number[],
  o: { timeoutMs?: number; listSockets?: () => Promise<string>; pollMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + (o.timeoutMs ?? 60_000);
  let busy = await boundPorts(ports, o);
  while (busy.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, o.pollMs ?? 1_000));
    busy = await boundPorts(ports, o);
  }
  if (busy.length > 0) {
    throw new Error(
      `ports ${busy.join(', ')} are held by other sockets (ephemeral source ports?); ` +
        'reserve the block with net.ipv4.ip_local_reserved_ports=34000-34999 (root) or retry',
    );
  }
}

export async function assertPortsFree(
  ports: number[],
  o: { listSockets?: () => Promise<string> } = {},
): Promise<void> {
  const list =
    o.listSockets ??
    (async () => {
      const r = await run('ss', ['-ltnpH']);
      if (r.code !== 0) throw new Error(`ss -ltnpH failed: ${r.stderr.trim()}`);
      return r.stdout;
    });
  const wanted = new Set(ports);
  const busy = parseListeners(await list()).filter((l) => wanted.has(l.port));
  if (busy.length > 0) {
    const names = busy
      .map(
        (l) => `${l.port} (${l.address}${l.process ? `, ${l.process}` : ', holder not visible'})`,
      )
      .join('; ');
    throw new Error(`ports already in use: ${names}`);
  }
}
