/**
 * Domain rectification port (PRC-M321).
 *
 * A correction is only "applied" when the owning domain (student, staff, ...) actually
 * writes the new value. The privacy service reads the current value from the source
 * record (never from the client) and refuses to report `applied` when no applier is
 * configured or the write fails.
 */
export interface CorrectionTarget {
  tenantId: string;
  subjectType: string;
  subjectId: string;
  fieldPath: string;
}

export interface CorrectionApplier {
  /** Field paths this applier can rectify for the subject type; everything else is rejected. */
  allowedFieldPaths(subjectType: string): readonly string[];
  /** Server-side read of the current value. Throw NotFoundError when the subject is missing. */
  readCurrentValue(target: CorrectionTarget): Promise<string | null>;
  /** Persist the new value in the owning domain. Must throw on failure. */
  applyValue(target: CorrectionTarget & { value: string }): Promise<void>;
}

/**
 * Applier composed from per-subjectType domain appliers (e.g. student, staff).
 * Unknown subject types expose no field paths, so they fail closed.
 */
export class CompositeCorrectionApplier implements CorrectionApplier {
  constructor(private readonly bySubjectType: Readonly<Record<string, CorrectionApplier>>) {}

  private forType(subjectType: string): CorrectionApplier | undefined {
    return Object.prototype.hasOwnProperty.call(this.bySubjectType, subjectType)
      ? this.bySubjectType[subjectType]
      : undefined;
  }

  allowedFieldPaths(subjectType: string): readonly string[] {
    return this.forType(subjectType)?.allowedFieldPaths(subjectType) ?? [];
  }

  async readCurrentValue(target: CorrectionTarget): Promise<string | null> {
    const applier = this.forType(target.subjectType);
    if (!applier) throw new Error(`No correction applier for subject type ${target.subjectType}`);
    return applier.readCurrentValue(target);
  }

  async applyValue(target: CorrectionTarget & { value: string }): Promise<void> {
    const applier = this.forType(target.subjectType);
    if (!applier) throw new Error(`No correction applier for subject type ${target.subjectType}`);
    await applier.applyValue(target);
  }
}
