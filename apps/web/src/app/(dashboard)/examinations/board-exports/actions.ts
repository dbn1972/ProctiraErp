'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import { createBoardExportJob } from '@/lib/api/gradebook';

export type BoardExportActionResult =
  | { ok: true; id: string; status: string; artifactUri: string | null; checksum?: string }
  | { ok: false; error: string; code?: string; status?: number };

export async function createBoardExportJobAction(input: {
  boardId?: string;
  boardCode?: string;
  institutionId: string;
  studentIds?: string[];
}): Promise<BoardExportActionResult> {
  try {
    const job = await createBoardExportJob(input);
    revalidatePath('/examinations/board-exports');
    revalidatePath('/examinations');
    return {
      ok: true,
      id: job.id,
      status: job.status,
      artifactUri: job.artifactUri,
      checksum:
        typeof job.metadata?.checksumSha256 === 'string'
          ? job.metadata.checksumSha256
          : undefined,
    };
  } catch (error) {
    if (error instanceof GatewayError) {
      return {
        ok: false,
        error: error.message,
        code: error.code,
        status: error.status,
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unexpected error',
    };
  }
}
