/**
 * Minimal RESP2 client for live-Redis tests in this package (which does not depend on ioredis).
 * Implements just the {@link RedisLikeForPasswordThrottle} surface plus KEYS/QUIT for cleanup.
 * Test-only: one in-flight command at a time per connection, no reconnects.
 */
import { connect, type Socket } from 'node:net';

import type { RedisLikeForPasswordThrottle } from './password-throttle.js';

type Reply = string | number | null | Reply[] | Error;

function encode(args: Array<string | number>): string {
  let out = `*${args.length}\r\n`;
  for (const arg of args) {
    const value = String(arg);
    out += `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
  }
  return out;
}

/** Parses one reply from `buf` at `offset`; returns undefined when more bytes are needed. */
function parse(buf: Buffer, offset: number): { value: Reply; next: number } | undefined {
  const lineEnd = buf.indexOf('\r\n', offset);
  if (lineEnd < 0) return undefined;
  const type = String.fromCharCode(buf[offset] ?? 0);
  const line = buf.toString('utf8', offset + 1, lineEnd);
  const after = lineEnd + 2;
  if (type === '+') return { value: line, next: after };
  if (type === '-') return { value: new Error(line), next: after };
  if (type === ':') return { value: Number(line), next: after };
  if (type === '$') {
    const len = Number(line);
    if (len < 0) return { value: null, next: after };
    if (buf.length < after + len + 2) return undefined;
    return { value: buf.toString('utf8', after, after + len), next: after + len + 2 };
  }
  if (type === '*') {
    const count = Number(line);
    if (count < 0) return { value: null, next: after };
    const items: Reply[] = [];
    let cursor = after;
    for (let i = 0; i < count; i += 1) {
      const item = parse(buf, cursor);
      if (!item) return undefined;
      items.push(item.value);
      cursor = item.next;
    }
    return { value: items, next: cursor };
  }
  throw new Error(`unexpected RESP type ${type}`);
}

export class RespTestClient implements RedisLikeForPasswordThrottle {
  private buffer = Buffer.alloc(0);
  private pending: Array<{ resolve: (value: Reply) => void; reject: (error: Error) => void }> = [];

  private constructor(private readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (;;) {
        const parsed = parse(this.buffer, 0);
        if (!parsed) break;
        this.buffer = this.buffer.subarray(parsed.next);
        const waiter = this.pending.shift();
        if (!waiter) continue;
        if (parsed.value instanceof Error) waiter.reject(parsed.value);
        else waiter.resolve(parsed.value);
      }
    });
    socket.on('error', (error) => {
      for (const waiter of this.pending.splice(0)) waiter.reject(error);
    });
  }

  static async connect(redisUrl: string): Promise<RespTestClient> {
    const url = new URL(redisUrl);
    const socket = connect({ host: url.hostname, port: Number(url.port || 6379) });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', reject);
    });
    const client = new RespTestClient(socket);
    if (url.password) {
      await client.command(
        url.username
          ? ['AUTH', decodeURIComponent(url.username), decodeURIComponent(url.password)]
          : ['AUTH', decodeURIComponent(url.password)],
      );
    }
    const db = url.pathname.replace('/', '');
    if (db) await client.command(['SELECT', db]);
    return client;
  }

  command(args: Array<string | number>): Promise<Reply> {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket.write(encode(args));
    });
  }

  async eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown> {
    return this.command(['EVAL', script, numKeys, ...args]);
  }

  async pttl(key: string): Promise<number> {
    return Number(await this.command(['PTTL', key]));
  }

  async del(...keys: string[]): Promise<number> {
    return Number(await this.command(['DEL', ...keys]));
  }

  async keys(pattern: string): Promise<string[]> {
    return ((await this.command(['KEYS', pattern])) as string[] | null) ?? [];
  }

  async quit(): Promise<void> {
    await this.command(['QUIT']).catch(() => undefined);
    this.socket.destroy();
  }
}
