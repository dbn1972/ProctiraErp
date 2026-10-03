'use server';
/**
 * DSAR export server action (PRC-M084).
 *
 * The export runs only when the user presses "Build package" (a POST server
 * action), never on page render or refresh. The gateway records an audit row
 * (actor, subject, entry count) for each export before returning the package.
 */
import { exportDsarPackage, type DsarPackage } from '@/lib/api/platform.server';
import type { PlatformAccess } from '@/lib/api/platform.server';
import { loadStaffOptions, loadStudentOptions, withPersonLabels } from '@/lib/load-entity-labels';

const SUBJECT = /^[A-Za-z0-9._@-]{1,200}$/;

export interface DsarExportResult {
  status: 'ok' | 'invalid' | 'forbidden' | 'unavailable' | 'error';
  pack: DsarPackage | null;
  /** Raw gateway package for the JSON download (includes changed values). */
  downloadJson: string | null;
  /** id -> human label for subject, entity and actor ids in the package. */
  labels: Record<string, string>;
  message?: string;
}

export async function buildDsarPackageAction(subjectIdInput: string): Promise<DsarExportResult> {
  const subjectId = subjectIdInput.trim();
  const empty = { pack: null, downloadJson: null, labels: {} };
  if (!SUBJECT.test(subjectId)) {
    return { status: 'invalid', ...empty, message: 'Enter a valid subject id.' };
  }
  try {
    const result = await exportDsarPackage(subjectId);
    const access: PlatformAccess = result.access;
    if (access === 'forbidden') return { status: 'forbidden', ...empty };
    if (result.source === 'scaffold') return { status: 'unavailable', ...empty };
    if (!result.data) {
      return { status: 'error', ...empty, message: 'The DSAR export failed. Try again.' };
    }
    const pack = result.data;
    // Seed from the first directory pages, then resolve remaining person ids
    // (subject, actors, student/staff entities) individually (PRC-M083).
    const [students, staff] = await Promise.all([loadStudentOptions(), loadStaffOptions()]);
    const base = new Map<string, string>([
      ...students.map((o) => [o.id, o.label] as const),
      ...staff.map((o) => [o.id, `Staff · ${o.label}`] as const),
    ]);
    const PERSON_TYPES = new Set(['student', 'staff', 'user', 'guardian']);
    const labels = await withPersonLabels(base, [
      pack.subjectId,
      ...pack.entries.map((e) => e.userId),
      ...pack.entries.filter((e) => PERSON_TYPES.has(e.entityType)).map((e) => e.entityId),
    ]);
    return {
      status: 'ok',
      pack,
      downloadJson: JSON.stringify(result.raw ?? pack, null, 2),
      // Only labels for ids that appear in this package.
      labels: Object.fromEntries(
        [pack.subjectId, ...pack.entries.flatMap((e) => [e.entityId, e.userId])]
          .filter((id) => labels.has(id))
          .map((id) => [id, labels.get(id)!]),
      ),
    };
  } catch {
    return { status: 'error', ...empty, message: 'The DSAR export failed. Try again.' };
  }
}
