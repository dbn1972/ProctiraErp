import 'dart:async';
import 'dart:convert';

import 'package:sqflite/sqflite.dart';

import '../storage/database.dart';
import '../tenant/tenant_provider.dart';
import 'connectivity_monitor.dart';
import 'sync_dispatcher.dart';
import 'sync_models.dart';

/// Offline-first sync engine.
///
/// Responsibilities:
/// - Persist every pending mutation to the SQLite `pending_sync` queue in the
///   same transaction that writes to the entity-specific cache table
///   ("save locally first").
/// - Drain the queue on demand or whenever connectivity is restored.
/// - Translate transport / API failures into retries with exponential backoff
///   (up to [maxAttempts]); after that the row is parked for manual review.
/// - Detect 409 conflicts via the api-client's `If-Match` plumbing and route
///   the affected row into the `sync_conflicts` table while applying the
///   "server wins" default — the local cache is overwritten and the user's
///   change is preserved as a queued conflict that the UI can re-apply.
class SyncEngine {
  SyncEngine({
    required AppDatabase database,
    required TenantProvider tenantProvider,
    required ConnectivityMonitor connectivity,
    required Map<SyncEntityType, SyncDispatcher> dispatchers,
    int maxAttempts = 3,
    Duration baseBackoff = const Duration(seconds: 2),
    DateTime Function() now = _defaultNow,
  })  : _database = database,
        _tenantProvider = tenantProvider,
        _connectivity = connectivity,
        _dispatchers = dispatchers,
        _maxAttempts = maxAttempts,
        _baseBackoff = baseBackoff,
        _now = now;

  static DateTime _defaultNow() => DateTime.now();

  final AppDatabase _database;
  final TenantProvider _tenantProvider;
  final ConnectivityMonitor _connectivity;
  final Map<SyncEntityType, SyncDispatcher> _dispatchers;
  final int _maxAttempts;
  final Duration _baseBackoff;
  final DateTime Function() _now;

  StreamSubscription<bool>? _connectivitySubscription;
  bool _isFlushing = false;

  /// Begin listening for connectivity changes. When the device transitions to
  /// online the engine runs [flushPending].
  void start() {
    _connectivitySubscription ??= _connectivity.onlineStream.listen((bool online) {
      if (online) {
        // Fire-and-forget; failures are recorded against the queued rows.
        unawaited(flushPending());
      }
    });
  }

  /// Stop listening for connectivity events. Idempotent.
  Future<void> stop() async {
    await _connectivitySubscription?.cancel();
    _connectivitySubscription = null;
  }

  // ------------------------------------------------------------------
  // Public API: "save locally first".
  // ------------------------------------------------------------------

  /// Persist [cachePayload] to the entity cache table and queue an op for
  /// later sync. Both writes happen inside a single SQLite transaction.
  ///
  /// [cacheTable] is the offline cache table name, [cachePayload] is the row
  /// to upsert (must include the primary-key columns expected by that table),
  /// and [syncPayload] is the JSON payload that will be replayed against the
  /// API client.
  Future<int> saveLocallyAndQueue({
    required SyncEntityType entityType,
    required SyncOperation operation,
    required String cacheTable,
    required Map<String, Object?> cachePayload,
    required Map<String, dynamic> syncPayload,
    String? entityId,
    String? baseVersion,
  }) async {
    final String tenantId = _requireTenantId();
    final Database db = await _database.database;

    return db.transaction<int>((Transaction txn) async {
      await txn.insert(
        cacheTable,
        cachePayload,
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
      final int id = await txn.insert('pending_sync', <String, Object?>{
        'tenant_id': tenantId,
        'entity_type': entityType.toWire(),
        'entity_id': entityId,
        'operation': operation.toWire(),
        'payload': jsonEncode(syncPayload),
        'created_at': _now().millisecondsSinceEpoch,
        'attempts': 0,
        'last_attempt_at': null,
        'last_error': null,
        'base_version': baseVersion,
        'status': SyncStatus.pending.toWire(),
      });
      return id;
    });
  }

  /// Queue an op without writing to a cache table (e.g. deletes where the row
  /// is removed from the cache by the caller).
  Future<int> enqueue({
    required SyncEntityType entityType,
    required SyncOperation operation,
    required Map<String, dynamic> syncPayload,
    String? entityId,
    String? baseVersion,
  }) async {
    final String tenantId = _requireTenantId();
    final Database db = await _database.database;
    return db.insert('pending_sync', <String, Object?>{
      'tenant_id': tenantId,
      'entity_type': entityType.toWire(),
      'entity_id': entityId,
      'operation': operation.toWire(),
      'payload': jsonEncode(syncPayload),
      'created_at': _now().millisecondsSinceEpoch,
      'attempts': 0,
      'base_version': baseVersion,
      'status': SyncStatus.pending.toWire(),
    });
  }

  // ------------------------------------------------------------------
  // Inspection helpers (used by UI + tests).
  // ------------------------------------------------------------------

  Future<List<PendingSyncRow>> getPending({String? tenantId}) async {
    final Database db = await _database.database;
    final List<Map<String, Object?>> rows = await db.query(
      'pending_sync',
      where: tenantId == null ? null : 'tenant_id = ?',
      whereArgs: tenantId == null ? null : <Object>[tenantId],
      orderBy: 'created_at ASC, id ASC',
    );
    return rows.map(PendingSyncRow.fromDb).toList(growable: false);
  }

  Future<List<SyncConflict>> getConflicts({String? tenantId}) async {
    final Database db = await _database.database;
    final List<Map<String, Object?>> rows = await db.query(
      'sync_conflicts',
      where: tenantId == null ? null : 'tenant_id = ?',
      whereArgs: tenantId == null ? null : <Object>[tenantId],
      orderBy: 'detected_at ASC, id ASC',
    );
    return rows.map(SyncConflict.fromDb).toList(growable: false);
  }

  Future<int> pendingCount({String? tenantId}) async {
    final Database db = await _database.database;
    final List<Map<String, Object?>> rows = await db.rawQuery(
      tenantId == null
          ? "SELECT COUNT(*) AS c FROM pending_sync WHERE status = 'pending'"
          : "SELECT COUNT(*) AS c FROM pending_sync WHERE status = 'pending' AND tenant_id = ?",
      tenantId == null ? null : <Object>[tenantId],
    );
    if (rows.isEmpty) return 0;
    return (rows.first['c'] as num?)?.toInt() ?? 0;
  }

  // ------------------------------------------------------------------
  // Flush pipeline.
  // ------------------------------------------------------------------

  /// Drain the queue. Safe to call concurrently — additional callers no-op
  /// while a flush is in progress.
  Future<SyncFlushResult> flushPending() async {
    if (_isFlushing) {
      return const SyncFlushResult(
        processed: 0,
        synced: 0,
        failed: 0,
        conflicted: 0,
        parked: 0,
      );
    }
    _isFlushing = true;
    try {
      if (!await _connectivity.isOnline()) {
        return const SyncFlushResult(
          processed: 0,
          synced: 0,
          failed: 0,
          conflicted: 0,
          parked: 0,
        );
      }
      final String? tenantId = _tenantProvider.tenantId;
      final Database db = await _database.database;
      final int nowMs = _now().millisecondsSinceEpoch;

      final List<Map<String, Object?>> rawRows = await db.query(
        'pending_sync',
        where: tenantId == null
            ? "status = 'pending'"
            : "status = 'pending' AND tenant_id = ?",
        whereArgs: tenantId == null ? null : <Object>[tenantId],
        orderBy: 'created_at ASC, id ASC',
      );

      int processed = 0;
      int synced = 0;
      int failed = 0;
      int conflicted = 0;
      int parked = 0;

      for (final Map<String, Object?> raw in rawRows) {
        final PendingSyncRow row = PendingSyncRow.fromDb(raw);
        if (!_isReadyForRetry(row, nowMs)) {
          continue; // Backoff window not elapsed yet.
        }
        processed += 1;

        final SyncDispatcher? dispatcher = _dispatchers[row.entityType];
        if (dispatcher == null) {
          await _markPermanentFailure(
            row,
            'No dispatcher registered for ${row.entityType.name}',
          );
          parked += 1;
          continue;
        }

        DispatchOutcome outcome;
        try {
          outcome = await dispatcher.dispatch(row);
        } catch (error) {
          outcome = DispatchTransient(error.toString());
        }

        if (outcome is DispatchSuccess) {
          await _onSuccess(row, outcome);
          synced += 1;
        } else if (outcome is DispatchConflict) {
          await _onConflict(row, outcome);
          conflicted += 1;
        } else if (outcome is DispatchPermanent) {
          await _markPermanentFailure(row, outcome.message);
          parked += 1;
        } else if (outcome is DispatchTransient) {
          final bool exhausted = await _markTransientFailure(row, outcome.message);
          if (exhausted) {
            parked += 1;
          } else {
            failed += 1;
          }
        }
      }

      return SyncFlushResult(
        processed: processed,
        synced: synced,
        failed: failed,
        conflicted: conflicted,
        parked: parked,
      );
    } finally {
      _isFlushing = false;
    }
  }

  bool _isReadyForRetry(PendingSyncRow row, int nowMs) {
    if (row.attempts == 0 || row.lastAttemptAt == null) return true;
    final int waitMs =
        _baseBackoff.inMilliseconds * (1 << (row.attempts - 1));
    return nowMs - row.lastAttemptAt! >= waitMs;
  }

  Future<void> _onSuccess(PendingSyncRow row, DispatchSuccess outcome) async {
    final Database db = await _database.database;
    await db.transaction((Transaction txn) async {
      await txn.delete('pending_sync', where: 'id = ?', whereArgs: <Object>[row.id]);
      // Refresh local cache with server-canonical version when applicable.
      switch (row.entityType) {
        case SyncEntityType.attendance:
          if (outcome.serverVersion.isEmpty) break; // delete
          await txn.update(
            'attendance_offline',
            <String, Object?>{
              'version': outcome.serverVersion,
              'synced': 1,
            },
            where: 'id = ?',
            whereArgs: <Object>[
              outcome.serverEntityId ?? row.entityId ?? '',
            ],
          );
          break;
        case SyncEntityType.student:
          if (outcome.serverVersion.isNotEmpty &&
              outcome.serverEntityId != null) {
            await txn.update(
              'students_cache',
              <String, Object?>{
                'version': outcome.serverVersion,
                'updated_at': _now().millisecondsSinceEpoch,
              },
              where: 'id = ? AND tenant_id = ?',
              whereArgs: <Object>[outcome.serverEntityId!, row.tenantId],
            );
          }
          break;
        case SyncEntityType.enrollment:
          // Enrollment writes are read-mostly today; nothing to refresh in
          // the local cache beyond what the dispatcher already returned.
          break;
      }
    });
  }

  Future<bool> _markTransientFailure(PendingSyncRow row, String error) async {
    final Database db = await _database.database;
    final int newAttempts = row.attempts + 1;
    final bool exhausted = newAttempts >= _maxAttempts;
    await db.update(
      'pending_sync',
      <String, Object?>{
        'attempts': newAttempts,
        'last_attempt_at': _now().millisecondsSinceEpoch,
        'last_error': error,
        'status': exhausted
            ? SyncStatus.parked.toWire()
            : SyncStatus.pending.toWire(),
      },
      where: 'id = ?',
      whereArgs: <Object>[row.id],
    );
    return exhausted;
  }

  Future<void> _markPermanentFailure(PendingSyncRow row, String error) async {
    final Database db = await _database.database;
    await db.update(
      'pending_sync',
      <String, Object?>{
        'attempts': row.attempts + 1,
        'last_attempt_at': _now().millisecondsSinceEpoch,
        'last_error': error,
        'status': SyncStatus.parked.toWire(),
      },
      where: 'id = ?',
      whereArgs: <Object>[row.id],
    );
  }

  Future<void> _onConflict(PendingSyncRow row, DispatchConflict outcome) async {
    if (row.entityId == null) {
      await _markPermanentFailure(row, 'Conflict on row without entity id');
      return;
    }
    final Database db = await _database.database;
    final int detectedAt = _now().millisecondsSinceEpoch;

    await db.transaction((Transaction txn) async {
      // Server-wins default: overwrite the local cache with the server copy
      // when one was returned. The user's pending change is preserved in the
      // sync_conflicts table for re-application via UI.
      if (outcome.serverPayload != null) {
        switch (row.entityType) {
          case SyncEntityType.attendance:
            final Map<String, dynamic> server = outcome.serverPayload!;
            await txn.update(
              'attendance_offline',
              <String, Object?>{
                'institution_id': server['institutionId'],
                'class_id': server['classId'],
                'subject_id': server['subjectId'],
                'student_id': server['studentId'],
                'attendance_date': server['attendanceDate'],
                'status': server['status'],
                'remarks': server['comment'],
                'version': outcome.serverVersion,
                'synced': 1,
              },
              where: 'id = ?',
              whereArgs: <Object>[row.entityId!],
            );
            break;
          case SyncEntityType.student:
            // Student conflict resolution lives in the student feature; here
            // we just record the conflict.
            break;
          case SyncEntityType.enrollment:
            // Enrollment conflict resolution is handled in the student
            // enrollment feature; the conflict row is enough.
            break;
        }
      }

      await txn.insert('sync_conflicts', <String, Object?>{
        'tenant_id': row.tenantId,
        'entity_type': row.entityType.toWire(),
        'entity_id': row.entityId,
        'operation': row.operation.toWire(),
        'local_payload': jsonEncode(row.payload),
        'server_payload': outcome.serverPayload == null
            ? null
            : jsonEncode(outcome.serverPayload),
        'base_version': row.baseVersion,
        'server_version': outcome.serverVersion,
        'detected_at': detectedAt,
      });
      await txn.update(
        'pending_sync',
        <String, Object?>{
          'status': SyncStatus.conflicted.toWire(),
          'attempts': row.attempts + 1,
          'last_attempt_at': detectedAt,
          'last_error': 'Conflict (409)',
        },
        where: 'id = ?',
        whereArgs: <Object>[row.id],
      );
    });
  }

  String _requireTenantId() {
    final String? tenantId = _tenantProvider.tenantId;
    if (tenantId == null || tenantId.isEmpty) {
      throw StateError(
        'Cannot queue sync op without an active tenant. '
        'Ensure TenantProvider.setTenant() ran first.',
      );
    }
    return tenantId;
  }
}
