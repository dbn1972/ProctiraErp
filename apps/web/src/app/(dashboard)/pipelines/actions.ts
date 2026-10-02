'use server';

import { revalidatePath } from 'next/cache';
import { parseActionInput } from '@/lib/validation/server-action-input';
import { pipelineInputSchema } from '@/lib/validation/dashboard-action-schemas';

import { createPipeline } from '@/lib/api/etl';
import { GatewayError } from '@/lib/api/gateway';

export async function createPipelineAction(input: {
  name: string;
  sourceType: 'csv' | 'rest_api';
}): Promise<{ status: 'success' | 'error'; message?: string }> {
  const parsed = parseActionInput(pipelineInputSchema, input);
  if (!parsed.ok) return { status: 'error', message: parsed.message };
  input = parsed.data;
  try {
    await createPipeline(input);
    revalidatePath('/pipelines');
    return { status: 'success', message: 'Pipeline created' };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to create pipeline',
    };
  }
}
