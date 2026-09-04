/**
 * Institution infrastructure repair helpers (browser).
 *
 * Endpoints:
 *   GET  /institutions/:institutionId/infrastructure/:itemId/repairs
 *   POST /institutions/:institutionId/infrastructure/:itemId/repairs
 *
 * Body: { date (YYYY-MM-DD), notes, conditionAfter, cost? }
 */
import { browserGatewayFetch } from './browser-gateway';

export interface InfrastructureRepair {
  id: string;
  institutionId: string;
  infrastructureItemId: string;
  repairDate: string;
  notes: string;
  conditionAfter: string;
  cost: number | null;
  createdAt: string;
  updatedAt: string;
  /** Optional label filled client-side when aggregating. */
  facilityLabel?: string;
}

export interface CreateRepairInput {
  /** Repair date YYYY-MM-DD (defaults to today). */
  date?: string;
  notes: string;
  conditionAfter: string;
  cost?: number;
}

function unwrapList<T>(payload: { data?: T[] } | T[] | null | undefined): T[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload.data ?? [];
}

function repairsPath(institutionId: string, itemId: string): string {
  return `/institutions/${encodeURIComponent(institutionId)}/infrastructure/${encodeURIComponent(itemId)}/repairs`;
}

export async function listRepairsForItem(
  institutionId: string,
  itemId: string,
  options?: { signal?: AbortSignal },
): Promise<InfrastructureRepair[]> {
  const result = await browserGatewayFetch<{ data: InfrastructureRepair[] } | InfrastructureRepair[]>(
    repairsPath(institutionId, itemId),
    { method: 'GET', signal: options?.signal },
  );
  return unwrapList(result);
}

/**
 * Aggregate repair history across multiple facility items (newest first).
 */
export async function listRepairsForInstitution(
  institutionId: string,
  items: Array<{ id: string; label?: string }>,
  options?: { signal?: AbortSignal },
): Promise<InfrastructureRepair[]> {
  if (items.length === 0) return [];

  const batches = await Promise.all(
    items.map(async (item) => {
      try {
        const rows = await listRepairsForItem(institutionId, item.id, options);
        return rows.map((row) => ({
          ...row,
          facilityLabel: item.label,
        }));
      } catch {
        return [] as InfrastructureRepair[];
      }
    }),
  );

  return batches
    .flat()
    .sort((a, b) => {
      const da = a.repairDate || a.createdAt;
      const db = b.repairDate || b.createdAt;
      return db.localeCompare(da);
    });
}

export async function createRepair(
  institutionId: string,
  itemId: string,
  input: CreateRepairInput,
): Promise<InfrastructureRepair> {
  const today = new Date().toISOString().slice(0, 10);
  return browserGatewayFetch<InfrastructureRepair>(
    repairsPath(institutionId, itemId),
    {
      method: 'POST',
      json: {
        date: input.date?.trim() || today,
        notes: input.notes.trim(),
        conditionAfter: input.conditionAfter.trim(),
        ...(input.cost !== undefined ? { cost: input.cost } : {}),
      },
    },
  );
}
