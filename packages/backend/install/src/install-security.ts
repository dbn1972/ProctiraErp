/**
 * Install mutating-route security helpers: install-token + bootstrap-lock status codes.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

export const INSTALL_TOKEN_HEADER = 'x-install-token';

export interface InstallTokenGateOptions {
  /** Expected shared secret. When unset/empty, token gate is disabled (local tests). */
  installToken?: string;
}

/**
 * Resolve the configured install token from plugin options or env.
 */
export function resolveInstallToken(options?: InstallTokenGateOptions): string | undefined {
  const fromOptions = options?.installToken?.trim();
  if (fromOptions) return fromOptions;
  const fromEnv = process.env.INSTALL_TOKEN?.trim();
  return fromEnv || undefined;
}

/**
 * Require `X-Install-Token` when a token is configured.
 * Returns true when the request may proceed.
 */
export function enforceInstallToken(
  request: FastifyRequest,
  reply: FastifyReply,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken) return true;
  const provided = request.headers[INSTALL_TOKEN_HEADER];
  const value = Array.isArray(provided) ? provided[0] : provided;
  if (!value || value !== expectedToken) {
    void reply.status(401).send({
      success: false,
      error: 'Missing or invalid install token.',
    });
    return false;
  }
  return true;
}

/**
 * Map bootstrap-lock failures to HTTP 409 Conflict.
 */
export function statusForInstallResult(success: boolean, error?: string): number {
  if (success) return 200;
  if (error && /already finalized|bootstrap locked/i.test(error)) return 409;
  return 400;
}
