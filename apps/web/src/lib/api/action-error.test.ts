import { describe, expect, it, vi } from 'vitest';
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/workflows', () => ({
  createWorkflowDefinition: vi.fn(),
  decideWorkflowApproval: vi.fn(),
}));
import { GatewayError } from './gateway';
import * as actionError from './action-error';
import {
  CONFLICT_ACTION_MESSAGE,
  PERMISSION_DENIED_ACTION_MESSAGE,
  SAFE_CORRELATION_ID,
  genericActionErrorMessage,
  genericResultErrorMessage,
} from './action-error';
import { createWorkflowDefinition } from '@/lib/api/workflows';
import { createWorkflowDefinitionAction } from '@/app/(dashboard)/workflows/actions';
const RAW = 'insert or update on table "x" violates foreign key constraint "x_student_id_fkey"';
function quiet() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}
describe('genericActionErrorMessage (PRC-L250, RAW-WEB)', () => {
  it('hides non-gateway error text behind the fallback', () => {
    const spy = quiet();
    const message = genericActionErrorMessage(
      new TypeError('fetch failed http://internal-gateway:3000/api'),
      'Failed to save',
    );
    expect(message).toMatch(/^Failed to save \(ref [0-9a-z-]+\)$/);
    expect(message).not.toContain('internal');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it('never forwards the gateway envelope message', () => {
    const spy = quiet();
    const error = new GatewayError({
      status: 422,
      code: 'REFERENCE_NOT_FOUND',
      message: RAW,
      correlationId: 'corr-0123456789',
    });
    expect(genericActionErrorMessage(error, 'Failed to save')).toBe(
      'Failed to save (ref corr-0123456789)',
    );
    spy.mockRestore();
  });
  it('uses fixed copy for 401/403 and 409', () => {
    const spy = quiet();
    const denied = new GatewayError({ status: 403, code: 'FORBIDDEN', message: "No role 'x'" });
    const conflict = new GatewayError({ status: 409, code: 'CONFLICT', message: 'Name taken' });
    expect(genericActionErrorMessage(denied, 'Failed')).toContain(PERMISSION_DENIED_ACTION_MESSAGE);
    expect(genericActionErrorMessage(conflict, 'Failed')).toContain(CONFLICT_ACTION_MESSAGE);
    expect(genericActionErrorMessage(conflict, 'Failed')).not.toContain('Name taken');
    spy.mockRestore();
  });
  it('replaces an unsafe gateway correlation id with a local reference', () => {
    const spy = quiet();
    const error = new GatewayError({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'x',
      correlationId: '<script>',
    });
    const message = genericActionErrorMessage(error, 'Failed');
    expect(message).not.toContain('<script>');
    expect(message).toMatch(/^Failed \(ref [0-9a-z-]{8}\)$/);
    expect(SAFE_CORRELATION_ID.test('<script>')).toBe(false);
    spy.mockRestore();
  });
  it('applies the same rule to a throwOnError:false result', () => {
    const spy = quiet();
    const message = genericResultErrorMessage(
      {
        status: 400,
        error: { code: 'VALIDATION_ERROR', message: RAW },
        correlationId: 'corr-abcdef12',
      },
      'Could not add the room.',
    );
    expect(message).toBe('Could not add the room. (ref corr-abcdef12)');
    spy.mockRestore();
  });
  it('no longer exports the helper that forwarded gateway text', () => {
    expect('safeActionErrorMessage' in actionError).toBe(false);
  });
  it('is applied by server actions', async () => {
    const spy = quiet();
    vi.mocked(createWorkflowDefinition).mockRejectedValue(
      new GatewayError({ status: 400, code: 'VALIDATION_ERROR', message: RAW }),
    );
    const result = await createWorkflowDefinitionAction({
      name: 'Leave',
      module: 'hr',
      steps: [{ name: 'Head', approverRole: 'principal' }],
    });
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/^Failed to create definition \(ref /);
    expect(result.message).not.toContain('constraint');
    spy.mockRestore();
  });
});
