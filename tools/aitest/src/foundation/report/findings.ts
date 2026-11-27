/**
 * Track findings register (CONVENTIONS section 3.3): findings.csv with ids
 * AIT-T<NN>-<seq>, the program header and RFC 4180 quoting.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FINDINGS_HEADER =
  'id,track,severity,category,module,title,evidence,expected,actual,patch,prc_match';

export interface Finding {
  id: string;
  track: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'security' | 'privacy' | 'tenancy' | 'money' | 'grade' | 'other';
  module: string;
  title: string;
  evidence: string;
  expected: string;
  actual: string;
  patch: string;
  prc_match: string;
}

const COLUMNS = FINDINGS_HEADER.split(',') as Array<keyof Finding>;

export function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function findingsCsv(rows: readonly Finding[]): string {
  return `${[FINDINGS_HEADER, ...rows.map((f) => COLUMNS.map((c) => csvCell(String(f[c] ?? ''))).join(','))].join('\n')}\n`;
}

export class FindingsWriter {
  private readonly rows: Finding[] = [];
  private readonly track: string;

  constructor(
    private readonly outDir: string,
    trackNo: string,
  ) {
    if (!/^\d{2}$/.test(trackNo))
      throw new Error(`track number must be two digits, got ${trackNo}`);
    this.track = `T${trackNo}`;
  }

  add(f: Omit<Finding, 'id' | 'track'>): Finding {
    const id = `AIT-${this.track}-${String(this.rows.length + 1).padStart(3, '0')}`;
    const row: Finding = { id, track: this.track.toLowerCase(), ...f };
    this.rows.push(row);
    return row;
  }

  all(): readonly Finding[] {
    return this.rows;
  }

  write(): string {
    mkdirSync(this.outDir, { recursive: true });
    const file = join(this.outDir, 'findings.csv');
    writeFileSync(file, findingsCsv(this.rows));
    return file;
  }
}
