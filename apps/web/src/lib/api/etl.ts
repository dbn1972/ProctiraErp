/**
 * ETL pipelines client (Wave 10 Option C).
 */
import { GatewayError, gatewayFetch } from './gateway';

export interface EtlPipeline {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  source: { type: string };
  destination: { type: string };
  createdAt: string;
  updatedAt: string;
}

export async function listPipelines(): Promise<EtlPipeline[]> {
  const result = await gatewayFetch<{ data: EtlPipeline[] }>('/pipelines', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

/** PRC-M109: server-managed destination connection (no host/credentials). */
export interface EtlConnection {
  id: string;
  label: string;
  type: string;
}

export async function listEtlConnections(): Promise<EtlConnection[] | null> {
  const result = await gatewayFetch<{ data: EtlConnection[] }>('/pipelines/connections', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (!result.ok) return null;
  return result.data?.data ?? [];
}

export type PipelineSourceInput =
  | { type: 'csv'; fileContent: string; hasHeader: boolean }
  | { type: 'rest_api'; url: string; method: 'GET' };

/**
 * PRC-M109: only user-supplied source config and a connection id are sent;
 * the destination host/credentials are resolved by the ETL service.
 */
export async function createPipeline(input: {
  name: string;
  description?: string;
  source: PipelineSourceInput;
  connectionId: string;
  table: string;
  fieldMappings: Array<{ sourceField: string; destinationField: string }>;
  enabled: boolean;
}): Promise<EtlPipeline> {
  const result = await gatewayFetch<EtlPipeline>('/pipelines', {
    method: 'POST',
    json: {
      name: input.name,
      description: input.description,
      source: input.source,
      destination: { type: 'connection', connectionId: input.connectionId, table: input.table },
      fieldMappings: input.fieldMappings,
      enabled: input.enabled,
    },
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create pipeline',
    });
  }
  return result.data;
}
