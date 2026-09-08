/**
 * Storage for generated report-card PDFs (G-716).
 *
 * Jobs used to record an `outputUrl` while discarding the bytes. The artifact
 * store keeps them so `GET /report-cards/jobs/:jobId/download` can serve the
 * PDF. Keys are tenant-prefixed by the service (`report-cards/<tenant>/...`).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, sep } from 'node:path';

export interface ReportCardArtifactStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

export class InMemoryReportCardArtifactStore implements ReportCardArtifactStore {
  private readonly items = new Map<string, Buffer>();

  async put(key: string, bytes: Buffer): Promise<void> {
    this.items.set(key, Buffer.from(bytes));
  }

  async get(key: string): Promise<Buffer | null> {
    const found = this.items.get(key);
    return found ? Buffer.from(found) : null;
  }

  get size(): number {
    return this.items.size;
  }
}

/** Default on-disk location when `REPORT_CARD_ARTIFACT_DIR` is not set. */
export function defaultReportCardArtifactDir(): string {
  return process.env.REPORT_CARD_ARTIFACT_DIR ?? join(tmpdir(), 'proctira-report-cards');
}

/**
 * Filesystem-backed store. Keys are resolved beneath `rootDir` and any key
 * that would escape the root (`..`, absolute paths) is rejected.
 */
export class FilesystemReportCardArtifactStore implements ReportCardArtifactStore {
  constructor(private readonly rootDir: string = defaultReportCardArtifactDir()) {}

  private resolve(key: string): string {
    const safeKey = key.replace(/^[/\\]+/, '');
    const full = normalize(join(this.rootDir, safeKey));
    const root = normalize(this.rootDir).replace(/[/\\]+$/, '');
    if (full !== root && !full.startsWith(root + sep)) {
      throw new Error(`Artifact key escapes storage root: ${key}`);
    }
    return full;
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}

/** Filesystem store by default; in-memory when `REPORT_CARD_ARTIFACT_STORE=memory`. */
export function createReportCardArtifactStore(): ReportCardArtifactStore {
  if (process.env.REPORT_CARD_ARTIFACT_STORE === 'memory') {
    return new InMemoryReportCardArtifactStore();
  }
  return new FilesystemReportCardArtifactStore();
}
