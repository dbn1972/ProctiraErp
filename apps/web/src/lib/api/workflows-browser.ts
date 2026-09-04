/**
 * Browser-side workflow helpers for pause / resume.
 *
 * PUT /workflows/:id with `{ paused, status }`.
 */
import { browserGatewayFetch } from './browser-gateway';

export interface SetWorkflowPausedResult {
  id: string;
  paused?: boolean;
  status?: string;
  active?: boolean;
  name?: string;
  updatedAt?: string;
}

/**
 * Pause or resume a workflow definition.
 *
 * Sends both `paused` and `status` so either backend contract works:
 *   { paused: true,  status: 'paused' }
 *   { paused: false, status: 'active' }
 */
export async function setWorkflowPaused(
  definitionId: string,
  paused: boolean,
): Promise<SetWorkflowPausedResult> {
  return browserGatewayFetch<SetWorkflowPausedResult>(
    `/workflows/${encodeURIComponent(definitionId)}`,
    {
      method: 'PUT',
      json: {
        paused,
        status: paused ? 'paused' : 'active',
      },
    },
  );
}
