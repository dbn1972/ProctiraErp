import 'dart:convert';

import 'package:sqflite/sqflite.dart';

import '../../../core/storage/database.dart';
import '../../../core/tenant/tenant_provider.dart';

/// One enrollment history entry. Mirrors the relevant subset of the
/// `student_enrollment_history` table on the backend.
class EnrollmentEntry {
  EnrollmentEntry({
    required this.id,
    required this.studentId,
    this.institutionId,
    this.academicPeriodId,
    this.status,
    this.enrolledAt,
    this.exitedAt,
    this.payload = const <String, dynamic>{},
  });

  final String id;
  final String studentId;
  final String? institutionId;
  final String? academicPeriodId;
  final String? status;
  final String? enrolledAt;
  final String? exitedAt;
  final Map<String, dynamic> payload;

  String? get institutionName => payload['institutionName'] as String?;
  String? get academicPeriodName =>
      payload['academicPeriodName'] as String? ?? academicPeriodId;
}

class EnrollmentRepository {
  EnrollmentRepository({
    required AppDatabase database,
    required TenantProvider tenantProvider,
  })  : _database = database,
        _tenantProvider = tenantProvider;

  final AppDatabase _database;
  final TenantProvider _tenantProvider;

  /// Read all enrollment rows for a student grouped by academic period.
  Future<Map<String, List<EnrollmentEntry>>> historyByPeriod(
    String studentId,
  ) async {
    final String? tenantId = _tenantProvider.tenantId;
    if (tenantId == null) return const <String, List<EnrollmentEntry>>{};

    final Database db = await _database.database;
    final List<Map<String, Object?>> rows = await db.query(
      'enrollments_cache',
      where: 'tenant_id = ? AND student_id = ?',
      whereArgs: <Object>[tenantId, studentId],
      orderBy: 'enrolled_at DESC',
    );
    final Map<String, List<EnrollmentEntry>> grouped =
        <String, List<EnrollmentEntry>>{};
    for (final Map<String, Object?> row in rows) {
      final EnrollmentEntry entry = _fromRow(row);
      final String key = entry.academicPeriodName ?? 'No academic period';
      grouped.putIfAbsent(key, () => <EnrollmentEntry>[]).add(entry);
    }
    return grouped;
  }

  /// Insert a row into the cache. Used by tests; production seeds happen via
  /// the sync engine when an enrollment dispatcher comes online.
  Future<void> upsert(EnrollmentEntry entry) async {
    final String? tenantId = _tenantProvider.tenantId;
    if (tenantId == null) {
      throw StateError('Cannot persist enrollment without an active tenant.');
    }
    final Database db = await _database.database;
    await db.insert(
      'enrollments_cache',
      <String, Object?>{
        'id': entry.id,
        'tenant_id': tenantId,
        'student_id': entry.studentId,
        'institution_id': entry.institutionId,
        'academic_period_id': entry.academicPeriodId,
        'status': entry.status,
        'enrolled_at': entry.enrolledAt,
        'exited_at': entry.exitedAt,
        'payload': jsonEncode(entry.payload),
        'updated_at': DateTime.now().millisecondsSinceEpoch,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  EnrollmentEntry _fromRow(Map<String, Object?> row) {
    final String? rawPayload = row['payload'] as String?;
    final Map<String, dynamic> payload = (rawPayload == null || rawPayload.isEmpty)
        ? const <String, dynamic>{}
        : jsonDecode(rawPayload) as Map<String, dynamic>;
    return EnrollmentEntry(
      id: row['id'] as String,
      studentId: row['student_id'] as String,
      institutionId: row['institution_id'] as String?,
      academicPeriodId: row['academic_period_id'] as String?,
      status: row['status'] as String?,
      enrolledAt: row['enrolled_at'] as String?,
      exitedAt: row['exited_at'] as String?,
      payload: payload,
    );
  }
}
