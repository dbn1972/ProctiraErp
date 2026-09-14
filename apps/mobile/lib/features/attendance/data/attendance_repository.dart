import 'dart:convert';

import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import '../../../core/storage/cache_crypto.dart';
import '../../../core/storage/database.dart';
import '../../../core/sync/sync_engine.dart';
import '../../../core/sync/sync_models.dart';
import '../../../core/tenant/tenant_provider.dart';

/// In-memory representation of one row on the attendance roster.
class AttendanceRosterEntry {
  AttendanceRosterEntry({
    required this.studentId,
    required this.studentName,
    this.recordId,
    this.status,
    this.comment,
    this.version,
    this.synced = false,
  });

  final String studentId;
  final String studentName;

  /// Local id of the offline attendance row, if one already exists.
  String? recordId;
  AttendanceStatus? status;
  String? comment;
  String? version;
  bool synced;
}

/// Wraps the SQLite cache + [SyncEngine] for the attendance feature.
class AttendanceRepository {
  AttendanceRepository({
    required AppDatabase database,
    required TenantProvider tenantProvider,
    required SyncEngine syncEngine,
    required CacheCrypto cacheCrypto,
    StudentApi? studentApi,
    Uuid uuid = const Uuid(),
    DateTime Function() now = _defaultNow,
  })  : _database = database,
        _tenantProvider = tenantProvider,
        _syncEngine = syncEngine,
        _cacheCrypto = cacheCrypto,
        _studentApi = studentApi,
        _uuid = uuid,
        _now = now;

  static DateTime _defaultNow() => DateTime.now();

  final AppDatabase _database;
  final TenantProvider _tenantProvider;
  final SyncEngine _syncEngine;
  final CacheCrypto _cacheCrypto;
  final StudentApi? _studentApi;
  final Uuid _uuid;
  final DateTime Function() _now;

  /// Build the roster for a class on a given date.
  ///
  /// Reads from `students_cache` first; if the cache is empty AND a
  /// [StudentApi] is wired in AND the device is online, the API is queried
  /// and the rows are seeded into the cache for future offline use.
  Future<List<AttendanceRosterEntry>> loadRoster({
    required String institutionId,
    String? classId,
    required String date,
  }) async {
    final String tenantId = _requireTenantId();
    final Database db = await _database.database;

    List<Map<String, Object?>> rows = await db.query(
      'students_cache',
      where: 'tenant_id = ? AND institution_id = ?',
      whereArgs: <Object>[tenantId, institutionId],
      orderBy: 'full_name ASC',
    );

    if (rows.isEmpty && _studentApi != null) {
      try {
        final List<Student> remote = await _studentApi.listStudents(
          institutionId: institutionId,
          pageSize: 200,
        );
        if (remote.isNotEmpty) {
          await db.transaction((Transaction txn) async {
            for (final Student student in remote) {
              await txn.insert(
                'students_cache',
                await _studentCacheRow(tenantId, student),
                conflictAlgorithm: ConflictAlgorithm.replace,
              );
            }
          });
          rows = await db.query(
            'students_cache',
            where: 'tenant_id = ? AND institution_id = ?',
            whereArgs: <Object>[tenantId, institutionId],
            orderBy: 'full_name ASC',
          );
        }
      } on ApiException {
        // Ignore network errors; the screen falls back to whatever cache we
        // have (which may still be empty).
      }
    }

    if (classId != null && classId.isNotEmpty) {
      rows = rows.where((Map<String, Object?> row) {
        final String? cls = row['class_name'] as String?;
        return cls == classId;
      }).toList(growable: false);
    }

    final List<Map<String, Object?>> existing = await db.query(
      'attendance_offline',
      where:
          'tenant_id = ? AND institution_id = ? AND attendance_date = ?',
      whereArgs: <Object>[tenantId, institutionId, date],
    );
    final Map<String, Map<String, Object?>> byStudent = <String, Map<String, Object?>>{
      for (final Map<String, Object?> row in existing)
        row['student_id'] as String: row,
    };

    final List<AttendanceRosterEntry> roster = <AttendanceRosterEntry>[];
    for (final Map<String, Object?> row in rows) {
      final String studentId = row['id'] as String;
      final Map<String, Object?>? attendance = byStudent[studentId];
      AttendanceStatus? status;
      final String? rawStatus = attendance?['status'] as String?;
      if (rawStatus != null) {
        status = AttendanceStatus.fromWire(rawStatus);
      }
      roster.add(
        AttendanceRosterEntry(
          studentId: studentId,
          studentName: await _cacheCrypto.decrypt(row['full_name'] as String),
          recordId: attendance?['id'] as String?,
          status: status,
          comment: attendance?['remarks'] as String?,
          version: attendance?['version'] as String?,
          synced: ((attendance?['synced'] as int?) ?? 0) == 1,
        ),
      );
    }
    return roster;
  }

  /// Persist a new mark or replace an existing one. Always queues a sync op.
  Future<AttendanceRosterEntry> markAttendance({
    required AttendanceRosterEntry entry,
    required String institutionId,
    String? classId,
    String? subjectId,
    required String date,
    required AttendanceStatus status,
    required String recordedBy,
    String? comment,
    double? latitude,
    double? longitude,
  }) async {
    final String tenantId = _requireTenantId();
    final bool isUpdate = entry.recordId != null;
    final String recordId = entry.recordId ?? _uuid.v4();
    final int recordedAtMs = _now().millisecondsSinceEpoch;
    final String recordedAtIso =
        DateTime.fromMillisecondsSinceEpoch(recordedAtMs).toUtc().toIso8601String();

    final Map<String, Object?> cacheRow = <String, Object?>{
      'id': recordId,
      'tenant_id': tenantId,
      'institution_id': institutionId,
      'class_id': classId,
      'subject_id': subjectId,
      'student_id': entry.studentId,
      'attendance_date': date,
      'status': status.toWire(),
      'remarks': comment,
      'recorded_at': recordedAtMs,
      'synced': 0,
      'version': entry.version,
    };

    final Map<String, dynamic> syncPayload = <String, dynamic>{
      'id': recordId,
      'studentId': entry.studentId,
      'institutionId': institutionId,
      'classId': ?classId,
      'subjectId': ?subjectId,
      'attendanceDate': date,
      'status': status.toWire(),
      if (comment != null && comment.isNotEmpty) 'comment': comment,
      'recordedBy': recordedBy,
      'latitude': ?latitude,
      'longitude': ?longitude,
      'createdAt': recordedAtIso,
      'updatedAt': recordedAtIso,
    };

    await _syncEngine.saveLocallyAndQueue(
      entityType: SyncEntityType.attendance,
      operation: isUpdate ? SyncOperation.update : SyncOperation.create,
      cacheTable: 'attendance_offline',
      cachePayload: cacheRow,
      syncPayload: syncPayload,
      entityId: recordId,
      baseVersion: entry.version,
    );

    return AttendanceRosterEntry(
      studentId: entry.studentId,
      studentName: entry.studentName,
      recordId: recordId,
      status: status,
      comment: comment,
      version: entry.version,
    );
  }

  Future<Map<String, Object?>> _studentCacheRow(
    String tenantId,
    Student student,
  ) async {
    final String payload = jsonEncode(<String, dynamic>{
      'id': student.id,
      'firstName': student.firstName,
      'middleName': student.middleName,
      'lastName': student.lastName,
      'dateOfBirth': student.dateOfBirth,
      'gender': student.gender,
      'nationalId': student.nationalId,
      'institutionId': student.institutionId,
      'createdAt': student.createdAt,
      'updatedAt': student.updatedAt,
    });
    return <String, Object?>{
      'id': student.id,
      'tenant_id': tenantId,
      'institution_id': student.institutionId,
      'full_name': await _cacheCrypto.encrypt(student.fullName),
      'national_id': await _cacheCrypto.encryptNullable(student.nationalId),
      'grade': null,
      'class_name': null,
      'payload': await _cacheCrypto.encrypt(payload),
      'updated_at': _now().millisecondsSinceEpoch,
      'version': student.version,
    };
  }

  String _requireTenantId() {
    final String? tenantId = _tenantProvider.tenantId;
    if (tenantId == null || tenantId.isEmpty) {
      throw StateError('Cannot use attendance repository without an active tenant.');
    }
    return tenantId;
  }
}
