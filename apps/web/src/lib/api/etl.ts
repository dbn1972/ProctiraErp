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

export async function createPipeline(input: {
  name: string;
  description?: string;
  sourceType: 'csv' | 'rest_api';
}): Promise<EtlPipeline> {
  const source =
    input.sourceType === 'csv'
      ? { type: 'csv' as const, fileContent: 'id,name\n1,demo', hasHeader: true }
      : { type: 'rest_api' as const, url: 'https://example.invalid/data', method: 'GET' as const };
  const result = await gatewayFetch<EtlPipeline>('/pipelines', {
    method: 'POST',
    json: {
      name: input.name,
      description: input.description,
      source,
      destination: {
        type: 'postgresql',
        host: 'localhost',
        port: 5432,
        database: 'dw',
        username: 'etl',
        password: 'etl',
        table: 'etl_staging',
      },
      fieldMappings: [{ sourceField: 'id', destinationField: 'id' }],
      enabled: true,
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
