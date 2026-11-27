/**
 * PRC-L117: list-route query parameters. An id filter must be a UUID and a date
 * filter a real calendar date, or the request is refused with 400 before it can
 * reach a PG `uuid` / `date` column.
 */
import { DateSchema, validate } from '@proctira/validation';
import type { FastifyReply, FastifyRequest } from 'fastify';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface HostelQuerySpec {
  uuid?: readonly string[];
  date?: readonly string[];
}

export function invalidHostelQueryFields(
  query: unknown,
  spec: HostelQuerySpec,
): Array<{ field: string; message: string }> {
  const q = (query ?? {}) as Record<string, unknown>;
  const errors: Array<{ field: string; message: string }> = [];
  for (const field of spec.uuid ?? []) {
    const value = q[field];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
      errors.push({ field, message: `${field} must be a UUID` });
    }
  }
  for (const field of spec.date ?? []) {
    const value = q[field];
    if (value === undefined) continue;
    if (!validate(DateSchema, value).success) {
      errors.push({ field, message: `${field} must be a calendar date (YYYY-MM-DD)` });
    }
  }
  return errors;
}

/** Sends 400 VALIDATION_ERROR and returns false when a listed query parameter is malformed. */
export function requireValidHostelQuery(
  request: FastifyRequest,
  reply: FastifyReply,
  spec: HostelQuerySpec,
): boolean {
  const errors = invalidHostelQueryFields(request.query, spec);
  if (errors.length === 0) return true;
  void reply.status(400).send({
    code: 'VALIDATION_ERROR',
    message: 'Validation failed',
    statusCode: 400,
    errors,
  });
  return false;
}
