import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import '../../../core/storage/cache_crypto.dart';
import '../../../core/student/student_cache_sync.dart';
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
    this.queueStatus,
  });

  final String studentId;
  final String studentName;

  /// Local id of the offline attendance row, if one already exists.
  String? recordId;
  AttendanceStatus? status;
  String? comment;
  String? version;
  bool synced;

  /// Most severe state of any still-queued op for this mark (PRC-H011):
  /// `parked` / `conflicted` rows never reach the server on their own.
  SyncStatus? queueStatus;
}

/// Outcome of an explicit attendance submit (PRC-M038).
class AttendanceSubmitSummary {
  const AttendanceSubmitSummary({
    required this.synced,
    required this.failed,
    required this.conflicted,
    required this.stillQueued,
  });

  final int synced;
  final int failed;
  final int conflicted;

  /// Ops still in the queue after the flush (offline or retrying).
  final int stillQueued;

  bool get allSent => failed == 0 && conflicted == 0 && stillQueued == 0;

  /// Short, user-facing description of the result.
  String describe() {
    if (allSent) {
      return synced == 0
          ? 'All attendance is already submitted.'
          : 'Submitted $synced attendance ${synced == 1 ? 'mark' : 'marks'}.';
    }
    final List<String> parts = <String>[
      if (synced > 0) '$synced submitted',
      if (stillQueued > 0) '$stillQueued waiting to sync',
      if (failed > 0) '$failed failed',
      if (conflicted > 0) '$conflicted need review',
    ];
    return 'Attendance: ${parts.join(', ')}.';
  }
}

/// Roster plus refresh status, so the screen can show stale/error states
/// instead of an unexplained empty list (PRC-M032).
class RosterLoadResult {
  const RosterLoadResult({
    required this.entries,
    this.knownClasses = const <String>[],
    this.refreshed = false,
    this.refreshError,
  });

  final List<AttendanceRosterEntry> entries;

  /// Distinct class labels present in the cached roster (PRC-M031).
  final List<String> knownClasses;

  /// True when the roster was refreshed from the server on this load.
  final bool refreshed;

  /// Failure from the network refresh, if any. Entries are cached data.
  final Object? refreshError;

  /// Cached rows are being shown because the refresh failed.
  bool get isStale => refreshError != null;
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
  }) : _database = database,
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
  late final StudentCacheSync _cacheSync = StudentCacheSync(
    cacheCrypto: _cacheCrypto,
    now: _now,
  );

  /// Build the roster for a class on a given date (entries only).
  ///
  /// See [loadRosterWithStatus] for the refresh/error semantics.
  Future<List<AttendanceRosterEntry>> loadRoster({
    required String institutionId,
    String? classId,
    required String date,
    bool refresh = true,
  }) async {
    final RosterLoadResult result = await loadRosterWithStatus(
      institutionId: institutionId,
      classId: classId,
      date: date,
      refresh: refresh,
    );
    return result.entries;
  }

  /// Build the roster and report whether the network refresh succeeded.
  ///
  /// When [refresh] is true and a [StudentApi] is wired in, every page of
  /// the institution's students is fetched (PRC-M032) and the cache scope is
  /// replaced, so new students appear and removed ones disappear. A refresh
  /// failure never hides cached rows, but it is returned in
  /// [RosterLoadResult.refreshError] instead of being swallowed.
  ///
  /// [classId] filters on the cached `class_name` (case-insensitive), which
  /// is populated from the student payload (PRC-M031).
  Future<RosterLoadResult> loadRosterWithStatus({
    required String institutionId,
    String? classId,
    required String date,
    bool refresh = true,
  }) async {
    final String tenantId = _requireTenantId();
    final Database db = await _database.database;

    Object? refreshError;
    bool refreshed = false;
    final StudentApi? api = _studentApi;
    if (refresh && api != null) {
      try {
        final ({List<Student> students, bool complete}) remote =
            await _cacheSync.fetchAll(api, institutionId: institutionId);
        await _cacheSync.replaceScope(
          db,
          tenantId: tenantId,
          institutionId: institutionId,
          remote: remote.students,
          prune: remote.complete,
        );
        refreshed = true;
      } on ApiException catch (error) {
        refreshError = error;
      }
    }

    List<Map<String, Object?>> rows = await db.query(
      'students_cache',
      where: 'tenant_id = ? AND institution_id = ?',
      whereArgs: <Object>[tenantId, institutionId],
      orderBy: 'full_name ASC',
    );

    final List<String> classes =
        rows
            .map((Map<String, Object?> row) => row['class_name'] as String?)
            .whereType<String>()
            .where((String c) => c.trim().isNotEmpty)
            .toSet()
            .toList()
          ..sort();

    if (classId != null && classId.trim().isNotEmpty) {
      final String wanted = classId.trim().toLowerCase();
      rows = rows
          .where((Map<String, Object?> row) {
            final String? cls = row['class_name'] as String?;
            return cls != null && cls.trim().toLowerCase() == wanted;
          })
          .toList(growable: false);
    }

    return RosterLoadResult(
      entries: await _mergeMarks(
        db,
        tenantId: tenantId,
        institutionId: institutionId,
        date: date,
        rows: rows,
      ),
      knownClasses: classes,
      refreshed: refreshed,
      refreshError: refreshError,
    );
  }

  Future<List<AttendanceRosterEntry>> _mergeMarks(
    Database db, {
    required String tenantId,
    required String institutionId,
    required String date,
    required List<Map<String, Object?>> rows,
  }) async {
    final List<Map<String, Object?>> existing = await db.query(
      'attendance_offline',
      where: 'tenant_id = ? AND institution_id = ? AND attendance_date = ?',
      whereArgs: <Object>[tenantId, institutionId, date],
    );
    final Map<String, Map<String, Object?>> byStudent =
        <String, Map<String, Object?>>{
          for (final Map<String, Object?> row in existing)
            row['student_id'] as String: row,
        };

    final Map<String, SyncStatus> queueStatuses = await _syncEngine
        .entityQueueStatuses(SyncEntityType.attendance, tenantId: tenantId);

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
          queueStatus: queueStatuses[attendance?['id'] as String?],
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
    String? academicPeriodId,
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
    // The roster entry may be stale (e.g. the create synced after the roster
    // was loaded), so take the server version from the cache (PRC-H012).
    String? baseVersion = entry.version;
    if (isUpdate) {
      final Database db = await _database.database;
      final List<Map<String, Object?>> cached = await db.query(
        'attendance_offline',
        columns: <String>['version'],
        where: 'id = ? AND tenant_id = ?',
        whereArgs: <Object>[recordId, tenantId],
        limit: 1,
      );
      if (cached.isNotEmpty) {
        baseVersion = cached.first['version'] as String? ?? baseVersion;
      }
    }
    final int recordedAtMs = _now().millisecondsSinceEpoch;
    final String recordedAtIso = DateTime.fromMillisecondsSinceEpoch(
      recordedAtMs,
    ).toUtc().toIso8601String();

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
      'version': baseVersion,
    };

    final Map<String, dynamic> syncPayload = <String, dynamic>{
      'id': recordId,
      'studentId': entry.studentId,
      'institutionId': institutionId,
      'classId': ?classId,
      'academicPeriodId': ?academicPeriodId,
      'subjectId': ?subjectId,
      'date': date,
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
      baseVersion: baseVersion,
      // Unsynced creates absorb later edits instead of queueing an update
      // without a base version (which used to be parked permanently).
      coalesceIntoPendingCreate: true,
    );

    return AttendanceRosterEntry(
      studentId: entry.studentId,
      studentName: entry.studentName,
      recordId: recordId,
      status: status,
      comment: comment,
      version: baseVersion,
      queueStatus: SyncStatus.pending,
    );
  }

  /// Flush queued marks to the server now (PRC-M038) and report what is
  /// still waiting so the screen can say so instead of silently reloading.
  Future<AttendanceSubmitSummary> submitPending() async {
    final String tenantId = _requireTenantId();
    final SyncFlushResult flush = await _syncEngine.flushPending();
    final int pending = await _syncEngine.pendingCount(tenantId: tenantId);
    return AttendanceSubmitSummary(
      synced: flush.synced,
      failed: flush.failed + flush.parked,
      conflicted: flush.conflicted,
      stillQueued: pending,
    );
  }

  String _requireTenantId() {
    final String? tenantId = _tenantProvider.tenantId;
    if (tenantId == null || tenantId.isEmpty) {
      throw StateError(
        'Cannot use attendance repository without an active tenant.',
      );
    }
    return tenantId;
  }
}
