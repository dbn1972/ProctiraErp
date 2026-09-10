'use server';

import { revalidatePath } from 'next/cache';

import { createPipeline } from '@/lib/api/etl';
import { GatewayError } from '@/lib/api/gateway';

export async function createPipelineAction(input: {
  name: string;
  sourceType: 'csv' | 'rest_api';
}): Promise<{ status: 'success' | 'error'; message?: string }> {
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
