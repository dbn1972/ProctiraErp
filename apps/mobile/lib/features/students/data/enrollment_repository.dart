import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:sqflite/sqflite.dart';

import '../../../core/api/pagination.dart';
import '../../../core/errors/offline_fallback.dart';
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

  /// Parse a `GET /enrollments` row.
  factory EnrollmentEntry.fromJson(
    Map<String, dynamic> json,
    String studentId,
  ) {
    String? str(Object? v) => v is String && v.isNotEmpty ? v : null;
    return EnrollmentEntry(
      id: json['id'] as String,
      studentId: str(json['studentId']) ?? studentId,
      institutionId: str(json['institutionId']),
      academicPeriodId: str(json['academicPeriodId']),
      status: str(json['status']),
      enrolledAt: str(json['enrolledAt']),
      exitedAt: str(json['exitedAt']),
      payload: json,
    );
  }

  String? get institutionName => payload['institutionName'] as String?;
  String? get academicPeriodName =>
      payload['academicPeriodName'] as String? ?? academicPeriodId;
}

class EnrollmentRepository {
  EnrollmentRepository({
    required AppDatabase database,
    required TenantProvider tenantProvider,
    Dio? dio,
  }) : _database = database,
       _tenantProvider = tenantProvider,
       _dio = dio;

  final AppDatabase _database;
  final TenantProvider _tenantProvider;
  final Dio? _dio;

  static const String _path = '/api/v1/enrollments';
  static const int _maxPages = 20;

  /// Pull the student's enrollments from `GET /api/v1/enrollments` (all
  /// pages) and replace their cached rows (PRC-M041).
  ///
  /// Returns `true` when the cache is fresh, `false` when the server was
  /// unreachable and the caller should mark the cached view as stale.
  /// Authorisation and server errors are rethrown.
  Future<bool> refresh(String studentId) async {
    final Dio? dio = _dio;
    final String? tenantId = _tenantProvider.tenantId;
    if (dio == null || tenantId == null || tenantId.isEmpty) return false;
    final List<Map<String, dynamic>> remote = <Map<String, dynamic>>[];
    try {
      for (int page = 1; page <= _maxPages; page++) {
        final Response<dynamic> response = await dio.get<dynamic>(
          _path,
          queryParameters: <String, dynamic>{
            'studentId': studentId,
            'page': page,
            'pageSize': kMaxApiPageSize,
          },
        );
        final Object? body = response.data;
        final Object? data = body is Map ? body['data'] : null;
        final List<Map<String, dynamic>> batch = data is List
            ? data.whereType<Map<String, dynamic>>().toList(growable: false)
            : const <Map<String, dynamic>>[];
        remote.addAll(batch);
        if (batch.length < kMaxApiPageSize) break;
      }
    } on DioException catch (error) {
      if (isOfflineError(error)) return false;
      rethrow;
    }
    final Database db = await _database.database;
    await db.transaction((Transaction txn) async {
      await txn.delete(
        'enrollments_cache',
        where: 'tenant_id = ? AND student_id = ?',
        whereArgs: <Object>[tenantId, studentId],
      );
      for (final Map<String, dynamic> json in remote) {
        // Defence in depth: never cache another student's rows here.
        if (json['studentId'] != null && json['studentId'] != studentId) {
          continue;
        }
        await txn.insert(
          'enrollments_cache',
          _toRow(tenantId, EnrollmentEntry.fromJson(json, studentId)),
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
    });
    return true;
  }

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
      _toRow(tenantId, entry),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Map<String, Object?> _toRow(String tenantId, EnrollmentEntry entry) =>
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
      };

  EnrollmentEntry _fromRow(Map<String, Object?> row) {
    final String? rawPayload = row['payload'] as String?;
    final Map<String, dynamic> payload =
        (rawPayload == null || rawPayload.isEmpty)
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
