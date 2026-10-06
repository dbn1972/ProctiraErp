'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createPipeline } from '@/lib/api/etl';
import { GatewayError } from '@/lib/api/gateway';

/** PRC-M109: inline CSV is capped well under the Server Action body limit. */
const MAX_CSV_BYTES = 1024 * 1024;
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const pipelineSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(255),
    description: z.string().trim().max(1000).optional(),
    sourceType: z.enum(['csv', 'rest_api']),
    csvContent: z.string().max(MAX_CSV_BYTES, 'CSV must be 1 MB or smaller').optional(),
    restUrl: z.string().trim().max(2000).optional(),
    connectionId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'Choose a destination connection'),
    table: z.string().trim().regex(COLUMN, 'Table must be a plain SQL identifier').max(63),
    mappings: z.string().trim().min(1, 'Add at least one field mapping').max(10_000),
    enabled: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.sourceType === 'csv' && !v.csvContent?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['csvContent'], message: 'Upload or paste CSV data' });
    }
    if (v.sourceType === 'rest_api') {
      try {
        const url = new URL(v.restUrl ?? '');
        if (url.protocol !== 'https:') throw new Error('https only');
      } catch {
        ctx.addIssue({ code: 'custom', path: ['restUrl'], message: 'Enter an https:// URL' });
      }
    }
  });

export type CreatePipelineValues = z.input<typeof pipelineSchema>;

/** "source -> destination" per line (also accepts ':' or ','). */
function parseMappings(
  text: string,
): Array<{ sourceField: string; destinationField: string }> | string {
  const out: Array<{ sourceField: string; destinationField: string }> = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const [from, to] = line.split(/\s*(?:->|:|,)\s*/);
    const sourceField = from?.trim() ?? '';
    const destinationField = (to ?? from)?.trim() ?? '';
    if (!sourceField || !COLUMN.test(destinationField)) {
      return `Mapping line ${index + 1} must look like "source_field -> destination_column".`;
    }
    out.push({ sourceField, destinationField });
  }
  return out.length > 0 ? out : 'Add at least one field mapping';
}

export async function createPipelineAction(
  input: CreatePipelineValues,
): Promise<{ status: 'success' | 'error'; message?: string }> {
  const parsed = pipelineSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid pipeline' };
  }
  const v = parsed.data;
  const fieldMappings = parseMappings(v.mappings);
  if (typeof fieldMappings === 'string') return { status: 'error', message: fieldMappings };
  try {
    await createPipeline({
      name: v.name,
      description: v.description || undefined,
      source:
        v.sourceType === 'csv'
          ? { type: 'csv', fileContent: v.csvContent ?? '', hasHeader: true }
          : { type: 'rest_api', url: v.restUrl ?? '', method: 'GET' },
      connectionId: v.connectionId,
      table: v.table,
      fieldMappings,
      enabled: v.enabled,
    });
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
