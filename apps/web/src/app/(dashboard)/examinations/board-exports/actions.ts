'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import { createBoardExportJob } from '@/lib/api/gradebook';
import { getSession } from '@/lib/auth/server';
import { FORBIDDEN_MESSAGE } from '@/lib/auth/require-permission';
import { canModerateGrades } from '@/lib/gradebook-roles';
import { createBoardExportJobActionSchema } from '@/lib/validation/gradebook-workflow-schema';

export type BoardExportActionResult =
  | { ok: true; id: string; status: string; artifactUri: string | null; checksum?: string }
  | { ok: false; error: string; code?: string; status?: number };

export async function createBoardExportJobAction(input: {
  boardId?: string;
  boardCode?: string;
  institutionId: string;
  studentIds?: string[];
}): Promise<BoardExportActionResult> {
  // PRC-L237: mirror gradebook `board_export.create` (registrar roles) before the gateway call.
  const session = await getSession();
  if (!session || session.isExpired || !canModerateGrades(session.user.roles)) {
    return { ok: false, error: FORBIDDEN_MESSAGE, code: 'FORBIDDEN', status: 403 };
  }
  // PRC-L239: boundary validation (uuid ids, ≤500 students, no unknown keys).
  const parsed = createBoardExportJobActionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
      code: 'VALIDATION_ERROR',
      status: 400,
    };
  }
  try {
    const job = await createBoardExportJob(parsed.data);
    revalidatePath('/examinations/board-exports');
    revalidatePath('/examinations');
    return {
      ok: true,
      id: job.id,
      status: job.status,
      artifactUri: job.artifactUri,
      checksum:
        typeof job.metadata?.checksumSha256 === 'string' ? job.metadata.checksumSha256 : undefined,
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
