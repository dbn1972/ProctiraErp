import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant, type PgQueryable } from '@proctira/database';

import { ensureRegistrationSchema, type PgPoolLike } from '../pg-registration-repository.js';

import type {
  AdmissionsPipelineStore,
  ApplicationPlacement,
  EnquiryRecord,
  FollowupRecord,
  MeritListEntryRecord,
  MeritListRecord,
  OfferRecord,
  SeatMatrixRecord,
} from './pipeline-store.js';
import type { EnquirySource, EnquiryStage, FollowupStatus, OfferStatus } from './schemas.js';

let pipelineSchemaReady: Promise<void> | null = null;

function pipelineSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../../db/sql/034_admissions_crm_schema.sql'),
    join(process.cwd(), 'db/sql/034_admissions_crm_schema.sql'),
    join(process.cwd(), '../../db/sql/034_admissions_crm_schema.sql'),
  ];
  for (const path of candidates) {
    try {
      readFileSync(path, 'utf8');
      return path;
    } catch {
      // try next
    }
  }
  return candidates[0]!;
}

export async function ensureAdmissionsPipelineSchema(pool: PgPoolLike): Promise<void> {
  await ensureRegistrationSchema(pool);
  if (!pipelineSchemaReady) {
    pipelineSchemaReady = (async () => {
      const sql = readFileSync(pipelineSqlPath(), 'utf8');
      await pool.query(sql);
    })();
  }
  await pipelineSchemaReady;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function num(value: unknown, fallback = 0): number {
  if (value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mapEnquiry(row: Record<string, unknown>): EnquiryRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    institutionId: String(row.institution_id),
    institutionName: row.institution_name == null ? null : String(row.institution_name),
    academicPeriodId: String(row.academic_period_id),
    gradeId: String(row.grade_id),
    quota: String(row.quota),
    source: String(row.source) as EnquirySource,
    stage: String(row.stage) as EnquiryStage,
    firstName: String(row.first_name),
    lastName: String(row.last_name),
    dateOfBirth: dateOnly(row.date_of_birth),
    gender: String(row.gender),
    guardianName: String(row.guardian_name),
    guardianPhone: String(row.guardian_phone),
    guardianEmail: row.guardian_email == null ? null : String(row.guardian_email),
    interviewScore: row.interview_score == null ? null : num(row.interview_score),
    testScore: row.test_score == null ? null : num(row.test_score),
    applicationId: row.application_id == null ? null : String(row.application_id),
    notes: row.notes == null ? null : String(row.notes),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapFollowup(row: Record<string, unknown>): FollowupRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    enquiryId: String(row.enquiry_id),
    dueAt: toDate(row.due_at),
    ownerId: row.owner_id == null ? null : String(row.owner_id),
    notes: String(row.notes ?? ''),
    status: String(row.status) as FollowupStatus,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapSeat(row: Record<string, unknown>): SeatMatrixRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    institutionId: String(row.institution_id),
    academicPeriodId: String(row.academic_period_id),
    gradeId: String(row.grade_id),
    quota: String(row.quota),
    seats: num(row.seats),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapPlacement(row: Record<string, unknown>): ApplicationPlacement {
  return {
    applicationId: String(row.id),
    tenantId: String(row.tenant_id),
    institutionId: String(row.institution_id),
    academicPeriodId: String(row.academic_period_id),
    gradeId: String(row.grade_id),
    quota: String(row.quota ?? 'general'),
    interviewScore: num(row.interview_score),
    testScore: num(row.test_score),
    firstName: String(row.first_name),
    lastName: String(row.last_name),
    submittedAt: toDate(row.submitted_at),
  };
}

function mapMeritList(row: Record<string, unknown>): MeritListRecord {
  const snapshot =
    typeof row.weights_snapshot === 'string'
      ? (JSON.parse(row.weights_snapshot) as { interview: number; test: number })
      : ((row.weights_snapshot as { interview: number; test: number } | null) ?? {
          interview: num(row.interview_weight),
          test: num(row.test_weight),
        });
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    institutionId: String(row.institution_id),
    academicPeriodId: String(row.academic_period_id),
    gradeId: String(row.grade_id),
    interviewWeight: num(row.interview_weight),
    testWeight: num(row.test_weight),
    weightsSnapshot: snapshot,
    generatedAt: toDate(row.generated_at),
  };
}

function mapMeritEntry(row: Record<string, unknown>): MeritListEntryRecord {
  const snapshot =
    typeof row.weights_snapshot === 'string'
      ? (JSON.parse(row.weights_snapshot) as { interview: number; test: number })
      : ((row.weights_snapshot as { interview: number; test: number } | null) ?? {
          interview: 0,
          test: 0,
        });
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    meritListId: String(row.merit_list_id),
    applicationId: String(row.application_id),
    rank: num(row.rank),
    score: num(row.score),
    interviewScore: num(row.interview_score),
    testScore: num(row.test_score),
    weightsSnapshot: snapshot,
  };
}

function mapOffer(row: Record<string, unknown>): OfferRecord {
  const doc =
    typeof row.offer_document === 'string'
      ? (JSON.parse(row.offer_document) as Record<string, unknown>)
      : ((row.offer_document as Record<string, unknown> | null) ?? {});
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    applicationId: String(row.application_id),
    meritListId: row.merit_list_id == null ? null : String(row.merit_list_id),
    institutionId: String(row.institution_id),
    academicPeriodId: String(row.academic_period_id),
    gradeId: String(row.grade_id),
    quota: String(row.quota),
    status: String(row.status) as OfferStatus,
    feeAmount: num(row.fee_amount),
    feeCurrency: String(row.fee_currency ?? 'INR'),
    paymentRef: row.payment_ref == null ? null : String(row.payment_ref),
    offerFeeInvoiceId: row.offer_fee_invoice_id == null ? null : String(row.offer_fee_invoice_id),
    enrolledStudentId: row.enrolled_student_id == null ? null : String(row.enrolled_student_id),
    expiresAt: row.expires_at == null ? null : toDate(row.expires_at),
    offerDocument: doc,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export class PgAdmissionsPipelineStore implements AdmissionsPipelineStore {
  constructor(private readonly pool: PgPoolLike) {}

  private async withTenant<T>(
    tenantId: string,
    fn: (client: PgQueryable) => Promise<T>,
  ): Promise<T> {
    await ensureAdmissionsPipelineSchema(this.pool);
    return withPgTenant(this.pool, tenantId, fn);
  }

  async createEnquiry(record: EnquiryRecord): Promise<EnquiryRecord> {
    return this.withTenant(record.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO admission_enquiries (
           id, tenant_id, institution_id, academic_period_id, grade_id, quota, source, stage,
           first_name, last_name, date_of_birth, gender, guardian_name, guardian_phone,
           guardian_email, interview_score, test_score, application_id, notes, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
         ) RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.institutionId,
          record.academicPeriodId,
          record.gradeId,
          record.quota,
          record.source,
          record.stage,
          record.firstName,
          record.lastName,
          record.dateOfBirth,
          record.gender,
          record.guardianName,
          record.guardianPhone,
          record.guardianEmail,
          record.interviewScore,
          record.testScore,
          record.applicationId,
          record.notes,
          record.createdAt,
          record.updatedAt,
        ],
      );
      return mapEnquiry(result.rows[0] as Record<string, unknown>);
    });
  }

  async listEnquiries(tenantId: string): Promise<EnquiryRecord[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM admission_enquiries WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return (result.rows as Record<string, unknown>[]).map(mapEnquiry);
    });
  }

  async findEnquiry(tenantId: string, id: string): Promise<EnquiryRecord | null> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM admission_enquiries WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, id],
      );
      return result.rows[0] ? mapEnquiry(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async updateEnquiry(record: EnquiryRecord): Promise<EnquiryRecord> {
    return this.withTenant(record.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE admission_enquiries SET
           source = $3, stage = $4, quota = $5, interview_score = $6, test_score = $7,
           application_id = $8, notes = $9, updated_at = $10
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [
          record.tenantId,
          record.id,
          record.source,
          record.stage,
          record.quota,
          record.interviewScore,
          record.testScore,
          record.applicationId,
          record.notes,
          record.updatedAt,
        ],
      );
      return mapEnquiry(result.rows[0] as Record<string, unknown>);
    });
  }

  async createFollowup(record: FollowupRecord): Promise<FollowupRecord> {
    return this.withTenant(record.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO enquiry_followups (
           id, tenant_id, enquiry_id, due_at, owner_id, notes, status, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.enquiryId,
          record.dueAt,
          record.ownerId,
          record.notes,
          record.status,
          record.createdAt,
          record.updatedAt,
        ],
      );
      return mapFollowup(result.rows[0] as Record<string, unknown>);
    });
  }

  async listFollowups(tenantId: string, enquiryId: string): Promise<FollowupRecord[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM enquiry_followups
          WHERE tenant_id = $1 AND enquiry_id = $2
          ORDER BY due_at ASC`,
        [tenantId, enquiryId],
      );
      return (result.rows as Record<string, unknown>[]).map(mapFollowup);
    });
  }

  async upsertSeat(record: SeatMatrixRecord): Promise<SeatMatrixRecord> {
    return this.withTenant(record.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO seat_matrix (
           id, tenant_id, institution_id, academic_period_id, grade_id, quota, seats, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (tenant_id, institution_id, academic_period_id, grade_id, quota)
         DO UPDATE SET seats = EXCLUDED.seats, updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.institutionId,
          record.academicPeriodId,
          record.gradeId,
          record.quota,
          record.seats,
          record.createdAt,
          record.updatedAt,
        ],
      );
      return mapSeat(result.rows[0] as Record<string, unknown>);
    });
  }

  async listSeats(
    tenantId: string,
    filter?: { institutionId?: string; academicPeriodId?: string },
  ): Promise<SeatMatrixRecord[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM seat_matrix
          WHERE tenant_id = $1
            AND ($2::uuid IS NULL OR institution_id = $2)
            AND ($3::uuid IS NULL OR academic_period_id = $3)
          ORDER BY quota ASC, grade_id ASC`,
        [tenantId, filter?.institutionId ?? null, filter?.academicPeriodId ?? null],
      );
      return (result.rows as Record<string, unknown>[]).map(mapSeat);
    });
  }

  async findSeat(
    tenantId: string,
    key: { institutionId: string; academicPeriodId: string; gradeId: string; quota: string },
  ): Promise<SeatMatrixRecord | null> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM seat_matrix
          WHERE tenant_id = $1 AND institution_id = $2 AND academic_period_id = $3
            AND grade_id = $4 AND quota = $5
          LIMIT 1`,
        [tenantId, key.institutionId, key.academicPeriodId, key.gradeId, key.quota],
      );
      return result.rows[0] ? mapSeat(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async upsertPlacement(placement: ApplicationPlacement): Promise<ApplicationPlacement> {
    return this.withTenant(placement.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE admission_applications SET
           academic_period_id = $3, grade_id = $4, quota = $5,
           interview_score = $6, test_score = $7, updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [
          placement.tenantId,
          placement.applicationId,
          placement.academicPeriodId,
          placement.gradeId,
          placement.quota,
          placement.interviewScore,
          placement.testScore,
        ],
      );
      if (!result.rows[0]) {
        throw new Error(`Application ${placement.applicationId} not found for placement`);
      }
      return mapPlacement(result.rows[0] as Record<string, unknown>);
    });
  }

  async getPlacement(
    tenantId: string,
    applicationId: string,
  ): Promise<ApplicationPlacement | null> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM admission_applications WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, applicationId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row || row.academic_period_id == null || row.grade_id == null) return null;
      return mapPlacement(row);
    });
  }

  async listPlacements(
    tenantId: string,
    filter: { institutionId: string; academicPeriodId: string; gradeId: string },
  ): Promise<ApplicationPlacement[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM admission_applications
          WHERE tenant_id = $1 AND institution_id = $2
            AND academic_period_id = $3 AND grade_id = $4
          ORDER BY submitted_at ASC`,
        [tenantId, filter.institutionId, filter.academicPeriodId, filter.gradeId],
      );
      return (result.rows as Record<string, unknown>[]).map(mapPlacement);
    });
  }

  async replaceMeritList(
    list: MeritListRecord,
    entries: MeritListEntryRecord[],
  ): Promise<{ list: MeritListRecord; entries: MeritListEntryRecord[] }> {
    return this.withTenant(list.tenantId, async (client) => {
      const upserted = await client.query(
        `INSERT INTO merit_lists (
           id, tenant_id, institution_id, academic_period_id, grade_id,
           interview_weight, test_weight, weights_snapshot, generated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
         ON CONFLICT (tenant_id, institution_id, academic_period_id, grade_id)
         DO UPDATE SET
           interview_weight = EXCLUDED.interview_weight,
           test_weight = EXCLUDED.test_weight,
           weights_snapshot = EXCLUDED.weights_snapshot,
           generated_at = EXCLUDED.generated_at
         RETURNING *`,
        [
          list.id,
          list.tenantId,
          list.institutionId,
          list.academicPeriodId,
          list.gradeId,
          list.interviewWeight,
          list.testWeight,
          JSON.stringify(list.weightsSnapshot),
          list.generatedAt,
        ],
      );
      const saved = mapMeritList(upserted.rows[0] as Record<string, unknown>);
      await client.query(
        `DELETE FROM merit_list_entries WHERE merit_list_id = $1 AND tenant_id = $2`,
        [saved.id, list.tenantId],
      );
      const mapped: MeritListEntryRecord[] = [];
      for (const entry of entries) {
        const inserted = await client.query(
          `INSERT INTO merit_list_entries (
             id, tenant_id, merit_list_id, application_id, rank, score,
             interview_score, test_score, weights_snapshot
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
           RETURNING *`,
          [
            entry.id,
            list.tenantId,
            saved.id,
            entry.applicationId,
            entry.rank,
            entry.score,
            entry.interviewScore,
            entry.testScore,
            JSON.stringify(entry.weightsSnapshot),
          ],
        );
        mapped.push(mapMeritEntry(inserted.rows[0] as Record<string, unknown>));
      }
      return { list: saved, entries: mapped };
    });
  }

  async findMeritList(
    tenantId: string,
    filter: { institutionId: string; academicPeriodId: string; gradeId: string },
  ): Promise<{ list: MeritListRecord; entries: MeritListEntryRecord[] } | null> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM merit_lists
          WHERE tenant_id = $1 AND institution_id = $2 AND academic_period_id = $3 AND grade_id = $4
          LIMIT 1`,
        [tenantId, filter.institutionId, filter.academicPeriodId, filter.gradeId],
      );
      if (!result.rows[0]) return null;
      const list = mapMeritList(result.rows[0] as Record<string, unknown>);
      const entries = await client.query(
        `SELECT * FROM merit_list_entries WHERE tenant_id = $1 AND merit_list_id = $2 ORDER BY rank ASC`,
        [tenantId, list.id],
      );
      return {
        list,
        entries: (entries.rows as Record<string, unknown>[]).map(mapMeritEntry),
      };
    });
  }

  async findMeritListById(
    tenantId: string,
    id: string,
  ): Promise<{ list: MeritListRecord; entries: MeritListEntryRecord[] } | null> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM merit_lists WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, id],
      );
      if (!result.rows[0]) return null;
      const list = mapMeritList(result.rows[0] as Record<string, unknown>);
      const entries = await client.query(
        `SELECT * FROM merit_list_entries WHERE tenant_id = $1 AND merit_list_id = $2 ORDER BY rank ASC`,
        [tenantId, list.id],
      );
      return {
        list,
        entries: (entries.rows as Record<string, unknown>[]).map(mapMeritEntry),
      };
    });
  }

  async createOffer(record: OfferRecord): Promise<OfferRecord> {
    return this.withTenant(record.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO admission_offers (
           id, tenant_id, application_id, merit_list_id, institution_id, academic_period_id,
           grade_id, quota, status, fee_amount, fee_currency, payment_ref, offer_fee_invoice_id,
           enrolled_student_id, expires_at, offer_document, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18
         ) RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.applicationId,
          record.meritListId,
          record.institutionId,
          record.academicPeriodId,
          record.gradeId,
          record.quota,
          record.status,
          record.feeAmount,
          record.feeCurrency,
          record.paymentRef,
          record.offerFeeInvoiceId,
          record.enrolledStudentId,
          record.expiresAt,
          JSON.stringify(record.offerDocument),
          record.createdAt,
          record.updatedAt,
        ],
      );
      return mapOffer(result.rows[0] as Record<string, unknown>);
    });
  }

  async findOffer(tenantId: string, id: string): Promise<OfferRecord | null> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM admission_offers WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, id],
      );
      return result.rows[0] ? mapOffer(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async listOffers(tenantId: string, applicationId?: string): Promise<OfferRecord[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM admission_offers
          WHERE tenant_id = $1 AND ($2::uuid IS NULL OR application_id = $2)
          ORDER BY created_at DESC`,
        [tenantId, applicationId ?? null],
      );
      return (result.rows as Record<string, unknown>[]).map(mapOffer);
    });
  }

  async updateOffer(record: OfferRecord): Promise<OfferRecord> {
    return this.withTenant(record.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE admission_offers SET
           status = $3, payment_ref = $4, offer_fee_invoice_id = $5,
           enrolled_student_id = $6, offer_document = $7::jsonb, updated_at = $8
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [
          record.tenantId,
          record.id,
          record.status,
          record.paymentRef,
          record.offerFeeInvoiceId,
          record.enrolledStudentId,
          JSON.stringify(record.offerDocument),
          record.updatedAt,
        ],
      );
      return mapOffer(result.rows[0] as Record<string, unknown>);
    });
  }

  async countAcceptedSeats(
    tenantId: string,
    key: { institutionId: string; academicPeriodId: string; gradeId: string; quota: string },
  ): Promise<number> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT COUNT(*)::int AS count FROM admission_offers
          WHERE tenant_id = $1 AND institution_id = $2 AND academic_period_id = $3
            AND grade_id = $4 AND quota = $5 AND status = 'accepted'`,
        [tenantId, key.institutionId, key.academicPeriodId, key.gradeId, key.quota],
      );
      return num((result.rows[0] as { count: unknown } | undefined)?.count);
    });
  }
}
