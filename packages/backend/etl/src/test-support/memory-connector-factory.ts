/**
 * Test support (not exported from the package index): a connector factory that
 * keeps the production source connectors but routes `postgresql` destinations
 * to an in-memory sink, so service/route tests exercise real extract →
 * transform → load paths without the (fail-closed, PRC-M222) PG connector.
 */
import { defaultConnectorFactory, type ConnectorFactory } from '../connectors/index.js';
import type { DataRow, DestinationConnector, LoadResult } from '../connectors/types.js';

export class MemoryDestination implements DestinationConnector {
  readonly rows: DataRow[] = [];
  loadCalls = 0;

  async load(rows: DataRow[]): Promise<LoadResult> {
    this.loadCalls += 1;
    this.rows.push(...rows);
    return { loadedCount: rows.length, errorCount: 0, errors: [] };
  }

  async validate(): Promise<{ valid: boolean; error?: string }> {
    return { valid: true };
  }
}

export function memoryConnectorFactory(
  sink: DestinationConnector = new MemoryDestination(),
): ConnectorFactory {
  return {
    createSource: (config) => defaultConnectorFactory.createSource(config),
    createDestination: (config) =>
      config.type === 'postgresql' ? sink : defaultConnectorFactory.createDestination(config),
  };
}
