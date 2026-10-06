/**
 * PRC-M579 — gateway paths for the ETL screens. The gateway mounts the ETL
 * plugin at `/api/v1/pipelines` (domain-plugins.ts `etl` registrar); there is
 * no `/etl/*` alias. `browserGatewayFetch` adds the `/api/v1` prefix.
 */
export const ETL_PIPELINES_PATH = '/pipelines';

const seg = (value: string) => encodeURIComponent(value);

export const etlPaths = {
  pipelines: (query?: URLSearchParams) =>
    `${ETL_PIPELINES_PATH}${query && query.toString() ? `?${query.toString()}` : ''}`,
  pipeline: (pipelineId: string) => `${ETL_PIPELINES_PATH}/${seg(pipelineId)}`,
  execute: (pipelineId: string) => `${ETL_PIPELINES_PATH}/${seg(pipelineId)}/execute`,
  executions: (pipelineId: string, query?: URLSearchParams) =>
    `${ETL_PIPELINES_PATH}/${seg(pipelineId)}/executions${
      query && query.toString() ? `?${query.toString()}` : ''
    }`,
  execution: (pipelineId: string, executionId: string) =>
    `${ETL_PIPELINES_PATH}/${seg(pipelineId)}/executions/${seg(executionId)}`,
} as const;
