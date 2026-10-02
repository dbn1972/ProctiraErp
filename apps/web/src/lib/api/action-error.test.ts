import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/workflows', () => ({
  createWorkflowDefinition: vi.fn(),
  decideWorkflowApproval: vi.fn(),
}));

import { GatewayError } from './gateway';
import { safeActionErrorMessage } from './action-error';
import { createWorkflowDefinition } from '@/lib/api/workflows';
import { createWorkflowDefinitionAction } from '@/app/(dashboard)/workflows/actions';

describe('safeActionErrorMessage (PRC-L250)', () => {
  it('hides non-gateway error text behind the fallback', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const message = safeActionErrorMessage(
      new TypeError('fetch failed http://internal-gateway:3000/api'),
      'Failed to save',
    );
    expect(message).toMatch(/^Failed to save \(ref [0-9a-z-]+\)$/);
    expect(message).not.toContain('internal');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('keeps the user-facing gateway envelope message', () => {
    const error = new GatewayError({ status: 409, code: 'CONFLICT', message: 'Name taken' });
    expect(safeActionErrorMessage(error, 'Failed')).toBe('Name taken');
  });

  it('is applied by server actions', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(createWorkflowDefinition).mockRejectedValue(
      new TypeError('fetch failed http://internal-gateway:3000'),
    );
    const result = await createWorkflowDefinitionAction({
      name: 'Leave',
      module: 'hr',
      steps: [{ name: 'Head', approverRole: 'principal' }],
    });
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/^Failed to create definition/);
    expect(result.message).not.toContain('internal');
    spy.mockRestore();
  });
});
