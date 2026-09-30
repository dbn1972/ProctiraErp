import 'dart:async';
import 'dart:convert';

import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

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
    Duration flushInterval = const Duration(seconds: 30),
    Duration maxFlushInterval = const Duration(minutes: 5),
  }) : _database = database,
       _tenantProvider = tenantProvider,
       _connectivity = connectivity,
       _dispatchers = dispatchers,
       _maxAttempts = maxAttempts,
       _baseBackoff = baseBackoff,
       _now = now,
       _flushInterval = flushInterval,
       _maxFlushInterval = maxFlushInterval;

  static DateTime _defaultNow() => DateTime.now();

  final AppDatabase _database;
  final TenantProvider _tenantProvider;
  final ConnectivityMonitor _connectivity;
  final Map<SyncEntityType, SyncDispatcher> _dispatchers;
  final int _maxAttempts;
  final Duration _baseBackoff;
  final DateTime Function() _now;

  final Duration _flushInterval;
  final Duration _maxFlushInterval;

  StreamSubscription<bool>? _connectivitySubscription;
  Timer? _periodicTimer;
  bool _running = false;
  bool _isFlushing = false;
  bool _rerunRequested = false;
  int _idleBackoffLevel = 0;

  /// Whether [start] has been called (and [stop] has not).
  bool get isRunning => _running;

  /// Begin automatic draining (PRC-H010). Once started the engine flushes:
  /// - immediately (rows left over from a previous launch while online),
  /// - whenever the device transitions to online,
  /// - right after every [saveLocallyAndQueue] / [enqueue] (no-op offline),
  /// - on [requestFlush] (app resume / login, see `SyncLifecycleFlusher`),
  /// - on a periodic timer while pending rows exist, backing off
  ///   exponentially (capped at `maxFlushInterval`) while nothing syncs.
  void start() {
    if (_running) return;
    _running = true;
    _connectivitySubscription ??= _connectivity.onlineStream.listen((
      bool online,
    ) {
      if (online) {
        _idleBackoffLevel = 0;
        // Fire-and-forget; failures are recorded against the queued rows.
        unawaited(flushPending());
      }
    });
    unawaited(flushPending());
    _schedulePeriodic();
  }

  /// Stop automatic draining. Idempotent.
  Future<void> stop() async {
    _running = false;
    _periodicTimer?.cancel();
    _periodicTimer = null;
    await _connectivitySubscription?.cancel();
    _connectivitySubscription = null;
  }

  /// Ask the engine to drain now (e.g. app resumed, user logged in). Ignored
  /// until [start] has run so nothing is sent before the app is ready.
  void requestFlush() {
    if (!_running) return;
    _idleBackoffLevel = 0;
    unawaited(flushPending());
  }

  void _afterEnqueue() {
    if (_running) unawaited(flushPending());
  }

  void _schedulePeriodic() {
    _periodicTimer?.cancel();
    if (!_running) return;
    final int factor = 1 << _idleBackoffLevel;
    Duration delay = _flushInterval * factor;
    if (delay > _maxFlushInterval) delay = _maxFlushInterval;
    _periodicTimer = Timer(delay, () async {
      if (!_running) return;
      try {
        if (await pendingCount() > 0) {
          final SyncFlushResult result = await flushPending();
          if (result.synced > 0) {
            _idleBackoffLevel = 0;
          } else if (_flushInterval * (1 << _idleBackoffLevel) <
              _maxFlushInterval) {
            _idleBackoffLevel += 1;
          }
        } else {
          _idleBackoffLevel = 0;
        }
      } catch (_) {
        // Database closed / tenant switched; try again on the next tick.
      }
      _schedulePeriodic();
    });
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
    bool coalesceIntoPendingCreate = false,
  }) async {
    final String tenantId = _requireTenantId();
    final Database db = await _database.database;

    final int queuedId = await db.transaction<int>((Transaction txn) async {
      await txn.insert(
        cacheTable,
        cachePayload,
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
      // PRC-H012: an edit of a record whose create has never been sent is
      // folded into that create instead of queueing an update that has no
      // server version to send as If-Match.
      if (coalesceIntoPendingCreate &&
          operation == SyncOperation.update &&
          baseVersion == null &&
          entityId != null) {
        final List<Map<String, Object?>> creates = await txn.query(
          'pending_sync',
          columns: <String>['id'],
          where:
              'tenant_id = ? AND entity_type = ? AND entity_id = ? '
              "AND operation = 'create' AND status = 'pending' "
              'AND attempts = 0',
          whereArgs: <Object>[tenantId, entityType.toWire(), entityId],
          orderBy: 'id DESC',
          limit: 1,
        );
        if (creates.isNotEmpty) {
          final int existingId = creates.first['id']! as int;
          await txn.update(
            'pending_sync',
            <String, Object?>{'payload': jsonEncode(syncPayload)},
            where: 'id = ?',
            whereArgs: <Object>[existingId],
          );
          return existingId;
        }
      }
      final String idempotencyKey = const Uuid().v4();
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
        'idempotency_key': idempotencyKey,
      });
      return id;
    });
    _afterEnqueue();
    return queuedId;
  }

  /// Queue an op without writing to a cache table (e.g. deletes where the row
  /// is removed from the cache by the caller).
  Future<int> enqueue({
    required SyncEntityType entityType,
    required SyncOperation operation,
    required Map<String, dynamic> syncPayload,
    String? entityId,
    String? baseVersion,
    String? idempotencyKey,
  }) async {
    final String tenantId = _requireTenantId();
    final Database db = await _database.database;
    final String key = idempotencyKey ?? const Uuid().v4();
    final int queuedId = await db.insert('pending_sync', <String, Object?>{
      'tenant_id': tenantId,
      'entity_type': entityType.toWire(),
      'entity_id': entityId,
      'operation': operation.toWire(),
      'payload': jsonEncode(syncPayload),
      'created_at': _now().millisecondsSinceEpoch,
      'attempts': 0,
      'base_version': baseVersion,
      'status': SyncStatus.pending.toWire(),
      'idempotency_key': key,
    });
    _afterEnqueue();
    return queuedId;
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
  /// while a flush is in progress, but a follow-up pass is scheduled so rows
  /// queued mid-flush are not stranded until the next trigger.
  Future<SyncFlushResult> flushPending() async {
    if (_isFlushing) {
      _rerunRequested = true;
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

      // Entities whose create is still queued (any status). Updates/deletes
      // for them that carry no base version wait for the create instead of
      // being parked as "missing base version" (PRC-H012).
      final List<Map<String, Object?>> createRows = await db.query(
        'pending_sync',
        columns: <String>['entity_type', 'entity_id'],
        where: tenantId == null
            ? "operation = 'create' AND entity_id IS NOT NULL"
            : "operation = 'create' AND entity_id IS NOT NULL AND tenant_id = ?",
        whereArgs: tenantId == null ? null : <Object>[tenantId],
      );
      final Set<String> queuedCreates = <String>{
        for (final Map<String, Object?> c in createRows)
          '${c['entity_type']}:${c['entity_id']}',
      };

      for (final Map<String, Object?> raw in rawRows) {
        PendingSyncRow row = PendingSyncRow.fromDb(raw);
        if (!_isReadyForRetry(row, nowMs)) {
          continue; // Backoff window not elapsed yet.
        }
        if (row.operation != SyncOperation.create &&
            row.baseVersion == null &&
            row.entityId != null) {
          if (queuedCreates.contains(_entityKey(row))) {
            continue; // Wait for the create to land first.
          }
          // The create may have succeeded earlier in this pass and
          // back-filled base_version; re-read the row.
          final List<Map<String, Object?>> fresh = await db.query(
            'pending_sync',
            where: 'id = ?',
            whereArgs: <Object>[row.id],
          );
          if (fresh.isEmpty) continue;
          row = PendingSyncRow.fromDb(fresh.first);
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
          if (row.operation == SyncOperation.create) {
            queuedCreates.remove(_entityKey(row));
          }
          synced += 1;
        } else if (outcome is DispatchConflict) {
          await _onConflict(row, outcome);
          conflicted += 1;
        } else if (outcome is DispatchPermanent) {
          await _markPermanentFailure(row, outcome.message);
          parked += 1;
        } else if (outcome is DispatchTransient) {
          final bool exhausted = await _markTransientFailure(
            row,
            outcome.message,
          );
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
      if (_rerunRequested) {
        _rerunRequested = false;
        if (_running) unawaited(flushPending());
      }
    }
  }

  bool _isReadyForRetry(PendingSyncRow row, int nowMs) {
    if (row.attempts == 0 || row.lastAttemptAt == null) return true;
    final int waitMs = _baseBackoff.inMilliseconds * (1 << (row.attempts - 1));
    return nowMs - row.lastAttemptAt! >= waitMs;
  }

  static String _entityKey(PendingSyncRow row) =>
      '${row.entityType.toWire()}:${row.entityId}';

  Future<void> _onSuccess(PendingSyncRow row, DispatchSuccess outcome) async {
    final Database db = await _database.database;
    await db.transaction((Transaction txn) async {
      final List<Map<String, Object?>> current = await txn.query(
        'pending_sync',
        columns: <String>['payload'],
        where: 'id = ?',
        whereArgs: <Object>[row.id],
      );
      final bool editedInFlight =
          row.operation == SyncOperation.create &&
          outcome.serverVersion.isNotEmpty &&
          current.isNotEmpty &&
          jsonEncode(jsonDecode(current.first['payload']! as String)) !=
              jsonEncode(row.payload);
      if (editedInFlight) {
        // The user edited the record while its create was on the wire: the
        // server has the old payload, so replay the newest payload as an
        // update against the version the create just produced.
        await txn.update(
          'pending_sync',
          <String, Object?>{
            'operation': SyncOperation.update.toWire(),
            'base_version': outcome.serverVersion,
            'attempts': 0,
            'last_attempt_at': null,
            'last_error': null,
            'idempotency_key': const Uuid().v4(),
          },
          where: 'id = ?',
          whereArgs: <Object>[row.id],
        );
      } else {
        await txn.delete(
          'pending_sync',
          where: 'id = ?',
          whereArgs: <Object>[row.id],
        );
      }
      if (row.operation == SyncOperation.create &&
          outcome.serverVersion.isNotEmpty &&
          row.entityId != null) {
        // Queued follow-up edits now have a server version to send.
        await txn.update(
          'pending_sync',
          <String, Object?>{'base_version': outcome.serverVersion},
          where:
              'tenant_id = ? AND entity_type = ? AND entity_id = ? '
              "AND operation != 'create' AND base_version IS NULL",
          whereArgs: <Object>[
            row.tenantId,
            row.entityType.toWire(),
            row.entityId!,
          ],
        );
      }
      final List<Map<String, Object?>> remaining = row.entityId == null
          ? const <Map<String, Object?>>[]
          : await txn.rawQuery(
              'SELECT COUNT(*) AS c FROM pending_sync '
              'WHERE tenant_id = ? AND entity_type = ? AND entity_id = ?',
              <Object>[row.tenantId, row.entityType.toWire(), row.entityId!],
            );
      final bool stillQueued =
          remaining.isNotEmpty &&
          ((remaining.first['c'] as num?)?.toInt() ?? 0) > 0;
      // Refresh local cache with server-canonical version when applicable.
      switch (row.entityType) {
        case SyncEntityType.attendance:
          if (outcome.serverVersion.isEmpty) break; // delete
          await txn.update(
            'attendance_offline',
            <String, Object?>{
              'version': outcome.serverVersion,
              'synced': stillQueued ? 0 : 1,
            },
            where: 'id = ?',
            whereArgs: <Object>[outcome.serverEntityId ?? row.entityId ?? ''],
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
