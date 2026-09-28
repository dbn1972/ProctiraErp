import { BusinessRuleError, ConflictError, NotFoundError } from '@proctira/common';
import { withPgTenant, type PgQueryable } from '@proctira/database';
import type { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

import type { TransferActor, TransferDecision, TransferWorkflowStatus } from './state-machine.js';
import type {
  CreateTransferInput,
  EquivalencyInput,
  GradeEquivalencyRule,
  TransferApprovalEvent,
  TransferWorkflowRow,
} from './types.js';

const ROW_SQL = `
  SELECT t.id, t.tenant_id, t.student_id, t.source_institution_id, t.source_enrollment_id,
         t.destination_institution_id, t.destination_enrollment_id, t.destination_grade_id,
         t.destination_class_id, t.academic_period_id, t.transfer_date, t.reason,
         t.workflow_status, t.requested_by, t.created_at, t.updated_at,
         NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), '') AS student_name,
         src.name AS source_institution_name,
         sb.id AS source_board_id, sb.name AS source_board_name, sb.code AS source_board_code,
         dst.name AS destination_institution_name,
         db.id AS destination_board_id, db.name AS destination_board_name, db.code AS destination_board_code
    FROM transfer_records t
    LEFT JOIN students s
      ON s.id = t.student_id AND s.tenant_id = t.tenant_id AND s.deleted_at IS NULL
    LEFT JOIN institutions src
      ON src.id = t.source_institution_id AND src.tenant_id = t.tenant_id AND src.deleted_at IS NULL
    LEFT JOIN boards sb
      ON sb.id = src.board_id AND sb.tenant_id = t.tenant_id AND sb.deleted_at IS NULL
    LEFT JOIN institutions dst
      ON dst.id = t.destination_institution_id AND dst.tenant_id = t.tenant_id AND dst.deleted_at IS NULL
    LEFT JOIN boards db
      ON db.id = dst.board_id AND db.tenant_id = t.tenant_id AND db.deleted_at IS NULL
`;

function text(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function num(value: unknown): number {
  return Number(value);
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function mapRow(row: Record<string, unknown>): TransferWorkflowRow {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    studentName: text(row.student_name),
    sourceInstitutionId: String(row.source_institution_id),
    sourceInstitutionName: text(row.source_institution_name),
    sourceBoardId: text(row.source_board_id),
    sourceBoardName: text(row.source_board_name),
    sourceBoardCode: text(row.source_board_code),
    sourceEnrollmentId: String(row.source_enrollment_id),
    destinationInstitutionId: String(row.destination_institution_id),
    destinationInstitutionName: text(row.destination_institution_name),
    destinationBoardId: text(row.destination_board_id),
    destinationBoardName: text(row.destination_board_name),
    destinationBoardCode: text(row.destination_board_code),
    destinationEnrollmentId: text(row.destination_enrollment_id),
    destinationGradeId: text(row.destination_grade_id) ?? '',
    destinationClassId: text(row.destination_class_id) ?? '',
    academicPeriodId: text(row.academic_period_id) ?? '',
    transferDate: iso(row.transfer_date).slice(0, 10),
    reason: String(row.reason ?? ''),
    status: String(row.workflow_status) as TransferWorkflowStatus,
    requestedBy: text(row.requested_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export class PgTransferWorkflowStore {
  constructor(private readonly pool: Pool) {}

  async create(
    tenantId: string,
    actor: TransferActor,
    input: CreateTransferInput,
  ): Promise<TransferWorkflowRow> {
    return withPgTenant(this.pool, tenantId, async (client) => {
      const source = await client.query(
        `SELECT e.id, e.student_id, e.institution_id, e.status
           FROM enrollments e
          WHERE e.tenant_id = $1 AND e.id = $2
          LIMIT 1`,
        [tenantId, input.sourceEnrollmentId],
      );
      const enrollment = source.rows[0] as
        { id: string; student_id: string; institution_id: string; status: string } | undefined;
      if (!enrollment) throw new BusinessRuleError('Source enrollment was not found');
      if (String(enrollment.student_id) !== input.studentId) {
        throw new BusinessRuleError('Source enrollment does not belong to this student');
      }
      if (String(enrollment.institution_id) !== input.sourceInstitutionId) {
        throw new BusinessRuleError('Source enrollment is not at the requesting school');
      }
      if (String(enrollment.status) !== 'ENROLLED') {
        throw new BusinessRuleError('Source enrollment must be ENROLLED');
      }
      const destination = await client.query(
        `SELECT id, status FROM institutions
          WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
          LIMIT 1`,
        [tenantId, input.destinationInstitutionId],
      );
      const school = destination.rows[0] as { status?: string } | undefined;
      if (!school) throw new BusinessRuleError('Destination institution was not found');
      if (String(school.status).toLowerCase() !== 'active') {
        throw new BusinessRuleError('Destination institution is inactive');
      }
      const id = uuidv4();
      const inserted = await client.query(
        `INSERT INTO transfer_records (
           id, tenant_id, student_id, source_institution_id, source_enrollment_id,
           destination_institution_id, destination_enrollment_id, destination_grade_id,
           destination_class_id, academic_period_id, transfer_date, reason,
           workflow_status, requested_by, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10::date,$11,'DRAFT',$12,NOW()
         ) RETURNING id`,
        [
          id,
          tenantId,
          input.studentId,
          input.sourceInstitutionId,
          input.sourceEnrollmentId,
          input.destinationInstitutionId,
          input.destinationGradeId,
          input.destinationClassId,
          input.academicPeriodId,
          input.transferDate,
          input.reason,
          actor.userId,
        ],
      );
      const createdId = String((inserted.rows[0] as { id: string }).id);
      const loaded = await this.selectOne(client, tenantId, createdId);
      if (!loaded) throw new NotFoundError('Transfer was not readable after insert');
      return loaded;
    });
  }

  async get(tenantId: string, id: string): Promise<TransferWorkflowRow | null> {
    return withPgTenant(this.pool, tenantId, async (client) =>
      this.selectOne(client, tenantId, id),
    );
  }

  async listOpen(tenantId: string): Promise<TransferWorkflowRow[]> {
    return withPgTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `${ROW_SQL}
          WHERE t.tenant_id = $1
            AND t.workflow_status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED')
          ORDER BY t.updated_at DESC
          LIMIT 100`,
        [tenantId],
      );
      return result.rows.map((row) => mapRow(row as Record<string, unknown>));
    });
  }

  async events(tenantId: string, transferId: string): Promise<TransferApprovalEvent[]> {
    return withPgTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT id, transfer_id, from_status, to_status, decision, actor_user_id,
                actor_role, actor_name, comment, created_at
           FROM transfer_approval_events
          WHERE tenant_id = $1 AND transfer_id = $2
          ORDER BY created_at ASC`,
        [tenantId, transferId],
      );
      return result.rows.map((row) => {
        const record = row as Record<string, unknown>;
        return {
          id: String(record.id),
          transferId: String(record.transfer_id),
          fromStatus: String(record.from_status) as TransferWorkflowStatus,
          toStatus: String(record.to_status) as TransferWorkflowStatus,
          decision: String(record.decision) as TransferApprovalEvent['decision'],
          actorUserId: String(record.actor_user_id),
          actorRole: String(record.actor_role),
          actorName: String(record.actor_name),
          comment: text(record.comment),
          createdAt: iso(record.created_at),
        };
      });
    });
  }

  async apply(input: {
    tenantId: string;
    transferId: string;
    expected: TransferWorkflowStatus;
    next: TransferWorkflowStatus;
    decision: TransferDecision;
    actor: TransferActor;
    comment: string | null;
  }): Promise<TransferWorkflowRow> {
    return withPgTenant(this.pool, input.tenantId, async (client) => {
      const locked = await client.query(
        `SELECT * FROM transfer_records WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [input.tenantId, input.transferId],
      );
      const current = locked.rows[0] as Record<string, unknown> | undefined;
      if (!current) throw new ConflictError('Transfer changed before the decision was saved');
      if (String(current.workflow_status) !== input.expected) {
        throw new ConflictError(
          `Cannot ${input.decision} a transfer that is ${String(current.workflow_status)}`,
        );
      }

      let destinationEnrollmentId = text(current.destination_enrollment_id);
      if (input.next === 'COMPLETED') {
        destinationEnrollmentId = await this.moveEnrollment(client, input.tenantId, current);
      }

      const updated = await client.query(
        `UPDATE transfer_records
            SET workflow_status = $3,
                destination_enrollment_id = COALESCE($4::uuid, destination_enrollment_id),
                updated_at = NOW()
          WHERE tenant_id = $1 AND id = $2 AND workflow_status = $5
          RETURNING id`,
        [input.tenantId, input.transferId, input.next, destinationEnrollmentId, input.expected],
      );
      if (updated.rows.length === 0) {
        throw new ConflictError('Transfer changed before the decision was saved');
      }

      await client.query(
        `INSERT INTO transfer_approval_events (
           id, tenant_id, transfer_id, from_status, to_status, decision,
           actor_user_id, actor_role, actor_name, comment
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          uuidv4(),
          input.tenantId,
          input.transferId,
          input.expected,
          input.next,
          input.decision,
          input.actor.userId,
          input.actor.roleIds[0] ?? 'unknown',
          input.actor.displayName,
          input.comment,
        ],
      );

      await client.query(
        `INSERT INTO audit_log_entries (
           id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
           ip_address, occurred_at, before_values, after_values, metadata
         ) VALUES ($1,$2,'transfer',$3,'UPDATE',$4,$5,$6,NOW(),$7::jsonb,$8::jsonb,$9::jsonb)`,
        [
          uuidv4(),
          input.tenantId,
          input.transferId,
          input.actor.userId,
          input.actor.displayName,
          input.actor.ipAddress || '0.0.0.0',
          JSON.stringify({ workflowStatus: input.expected }),
          JSON.stringify({ workflowStatus: input.next, decision: input.decision }),
          JSON.stringify({ comment: input.comment }),
        ],
      );

      if (input.next === 'COMPLETED') {
        await client.query(
          `INSERT INTO transactional_outbox (
             id, tenant_id, aggregate_type, aggregate_id, event_type, payload, metadata, status
           ) VALUES ($1,$2,'transfer',$3,'student.transfer.completed',$4::jsonb,'{}'::jsonb,'pending')`,
          [
            uuidv4(),
            input.tenantId,
            input.transferId,
            JSON.stringify({
              tenantId: input.tenantId,
              transferId: input.transferId,
              studentId: String(current.student_id),
              sourceInstitutionId: String(current.source_institution_id),
              destinationInstitutionId: String(current.destination_institution_id),
              sourceEnrollmentId: String(current.source_enrollment_id),
              destinationEnrollmentId,
            }),
          ],
        );
      }

      const loaded = await this.selectOne(client, input.tenantId, input.transferId);
      if (!loaded) throw new NotFoundError('Transfer was not readable after update');
      return loaded;
    });
  }

  async listEquivalency(
    tenantId: string,
    filter?: { sourceBoardId?: string; targetBoardId?: string; gradeCode?: string },
  ): Promise<GradeEquivalencyRule[]> {
    return withPgTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT r.*, sb.code AS source_board_code, tb.code AS target_board_code
           FROM grade_equivalency_rules r
           LEFT JOIN boards sb ON sb.id = r.source_board_id AND sb.tenant_id = r.tenant_id
           LEFT JOIN boards tb ON tb.id = r.target_board_id AND tb.tenant_id = r.tenant_id
          WHERE r.tenant_id = $1
            AND ($2::uuid IS NULL OR r.source_board_id = $2)
            AND ($3::uuid IS NULL OR r.target_board_id = $3)
            AND ($4::text IS NULL OR r.source_grade_code = $4)
          ORDER BY r.source_grade_code, r.source_subject`,
        [
          tenantId,
          filter?.sourceBoardId ?? null,
          filter?.targetBoardId ?? null,
          filter?.gradeCode ?? null,
        ],
      );
      return result.rows.map((row) => this.mapRule(row as Record<string, unknown>));
    });
  }

  async upsertEquivalency(
    tenantId: string,
    input: EquivalencyInput,
    id?: string,
  ): Promise<GradeEquivalencyRule> {
    return withPgTenant(this.pool, tenantId, async (client) => {
      if (id) {
        const updated = await client.query(
          `UPDATE grade_equivalency_rules
              SET source_board_id = $3, target_board_id = $4, source_grade_code = $5,
                  target_grade_code = $6, source_subject = $7, target_subject = $8,
                  source_marks_max = $9, target_marks_max = $10, credit_factor = $11,
                  mapping_status = $12, notes = $13, updated_at = NOW()
            WHERE tenant_id = $1 AND id = $2
            RETURNING *`,
          [
            tenantId,
            id,
            input.sourceBoardId,
            input.targetBoardId,
            input.sourceGradeCode,
            input.targetGradeCode,
            input.sourceSubject,
            input.targetSubject,
            input.sourceMarksMax,
            input.targetMarksMax,
            input.creditFactor,
            input.mappingStatus,
            input.notes ?? null,
          ],
        );
        const row = updated.rows[0] as Record<string, unknown> | undefined;
        if (!row) throw new NotFoundError('Equivalency rule not found');
        return this.mapRule(row);
      }
      const inserted = await client.query(
        `INSERT INTO grade_equivalency_rules (
           id, tenant_id, source_board_id, target_board_id, source_grade_code, target_grade_code,
           source_subject, target_subject, source_marks_max, target_marks_max, credit_factor,
           mapping_status, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          uuidv4(),
          tenantId,
          input.sourceBoardId,
          input.targetBoardId,
          input.sourceGradeCode,
          input.targetGradeCode,
          input.sourceSubject,
          input.targetSubject,
          input.sourceMarksMax,
          input.targetMarksMax,
          input.creditFactor,
          input.mappingStatus,
          input.notes ?? null,
        ],
      );
      return this.mapRule(inserted.rows[0] as Record<string, unknown>);
    });
  }

  async deleteEquivalency(tenantId: string, id: string): Promise<boolean> {
    return withPgTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `DELETE FROM grade_equivalency_rules WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [tenantId, id],
      );
      return result.rows.length > 0;
    });
  }

  private async selectOne(
    client: PgQueryable,
    tenantId: string,
    id: string,
  ): Promise<TransferWorkflowRow | null> {
    const result = await client.query(`${ROW_SQL} WHERE t.tenant_id = $1 AND t.id = $2 LIMIT 1`, [
      tenantId,
      id,
    ]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapRow(row) : null;
  }

  private async moveEnrollment(
    client: PgQueryable,
    tenantId: string,
    current: Record<string, unknown>,
  ): Promise<string> {
    const sourceId = String(current.source_enrollment_id);
    const reason = `Cross-board transfer approved: ${String(current.reason ?? '')}`;
    const effective = iso(current.transfer_date).slice(0, 10);
    await client.query(`SELECT set_config('app.enrollment_history_reason', $1, true)`, [reason]);
    await client.query(`SELECT set_config('app.enrollment_history_effective_date', $1, true)`, [
      effective,
    ]);
    const source = await client.query(
      `UPDATE enrollments
          SET status = 'TRANSFERRED'::enrollment_status, exited_at = $3::date, updated_at = NOW()
        WHERE tenant_id = $1 AND id = $2 AND status = 'ENROLLED'::enrollment_status
        RETURNING id, student_id, academic_period_id`,
      [tenantId, sourceId, effective],
    );
    if (source.rows.length === 0) {
      throw new BusinessRuleError('Source enrollment must be ENROLLED for this student');
    }
    const destinationId = uuidv4();
    await client.query(`SELECT set_config('app.enrollment_history_reason', $1, true)`, [
      `Transfer in: ${reason}`,
    ]);
    await client.query(
      `INSERT INTO enrollments (
         id, tenant_id, student_id, institution_id, grade_id, class_id, academic_period_id,
         status, enrolled_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'ENROLLED'::enrollment_status,$8::date)`,
      [
        destinationId,
        tenantId,
        String(current.student_id),
        String(current.destination_institution_id),
        String(current.destination_grade_id),
        String(current.destination_class_id),
        String(current.academic_period_id),
        effective,
      ],
    );
    return destinationId;
  }

  private mapRule(row: Record<string, unknown>): GradeEquivalencyRule {
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      sourceBoardId: String(row.source_board_id),
      sourceBoardCode: text(row.source_board_code),
      targetBoardId: String(row.target_board_id),
      targetBoardCode: text(row.target_board_code),
      sourceGradeCode: String(row.source_grade_code),
      targetGradeCode: String(row.target_grade_code),
      sourceSubject: String(row.source_subject),
      targetSubject: String(row.target_subject),
      sourceMarksMax: num(row.source_marks_max),
      targetMarksMax: num(row.target_marks_max),
      creditFactor: num(row.credit_factor),
      mappingStatus: String(row.mapping_status) as GradeEquivalencyRule['mappingStatus'],
      notes: text(row.notes),
    };
  }
}
