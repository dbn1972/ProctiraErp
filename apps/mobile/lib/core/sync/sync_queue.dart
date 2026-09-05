import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:sqflite/sqflite.dart';

import '../storage/database.dart';
import '../tenant/tenant_provider.dart';
import 'connectivity_monitor.dart';
import 'sync_models.dart';

/// Priority levels for sync operations.
///
/// Higher priority items are processed first during flush.
enum SyncPriority {
  /// Critical operations (e.g., attendance submission near deadline).
  high(0),

  /// Standard operations (default for most writes).
  normal(1),

  /// Background operations (e.g., profile photo upload).
  low(2);

  const SyncPriority(this.sortOrder);

  final int sortOrder;

  String toWire() => name;

  static SyncPriority fromWire(String value) {
    return SyncPriority.values.firstWhere(
      (SyncPriority v) => v.name == value,
      orElse: () => SyncPriority.normal,
    );
  }
}

/// Enhanced sync queue with priority levels, exponential backoff, and max 5
/// retries.
///
/// This class manages the pending_sync table with additional priority ordering
/// and configurable retry behavior. It replaces direct table access for
/// enqueue/dequeue operations.
class SyncQueue {
  SyncQueue({
    required AppDatabase database,
    required TenantProvider tenantProvider,
    required ConnectivityMonitor connectivity,
    this.maxRetries = 5,
    this.baseBackoff = const Duration(seconds: 2),
    this.maxBackoff = const Duration(minutes: 5),
    DateTime Function()? now,
  })  : _database = database,
        _tenantProvider = tenantProvider,
        _connectivity = connectivity,
        _now = now ?? _defaultNow;

  static DateTime _defaultNow() => DateTime.now();

  final AppDatabase _database;
  final TenantProvider _tenantProvider;
  // Reserved for future online-only enqueue gating.
  // ignore: unused_field
  final ConnectivityMonitor _connectivity;
  final int maxRetries;
  final Duration baseBackoff;
  final Duration maxBackoff;
  final DateTime Function() _now;

  /// Enqueue a sync operation with a given priority.
  ///
  /// The operation is persisted to SQLite immediately and will be processed
  /// during the next flush cycle, ordered by priority then creation time.
  Future<int> enqueue({
    required SyncEntityType entityType,
    required SyncOperation operation,
    required Map<String, dynamic> payload,
    SyncPriority priority = SyncPriority.normal,
    String? entityId,
    String? baseVersion,
  }) async {
    final String tenantId = _requireTenantId();
    final Database db = await _database.database;
    final int nowMs = _now().millisecondsSinceEpoch;

    return db.insert('pending_sync', <String, Object?>{
      'tenant_id': tenantId,
      'entity_type': entityType.toWire(),
      'entity_id': entityId,
      'operation': operation.toWire(),
      'payload': jsonEncode(payload),
      'created_at': nowMs,
      'attempts': 0,
      'last_attempt_at': null,
      'last_error': null,
      'base_version': baseVersion,
      'status': SyncStatus.pending.toWire(),
      'priority': priority.toWire(),
    });
  }

  /// Enqueue with a local cache write in the same transaction.
  Future<int> enqueueWithCache({
    required SyncEntityType entityType,
    required SyncOperation operation,
    required String cacheTable,
    required Map<String, Object?> cachePayload,
    required Map<String, dynamic> syncPayload,
    SyncPriority priority = SyncPriority.normal,
    String? entityId,
    String? baseVersion,
  }) async {
    final String tenantId = _requireTenantId();
    final Database db = await _database.database;
    final int nowMs = _now().millisecondsSinceEpoch;

    return db.transaction<int>((Transaction txn) async {
      await txn.insert(
        cacheTable,
        cachePayload,
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
      return txn.insert('pending_sync', <String, Object?>{
        'tenant_id': tenantId,
        'entity_type': entityType.toWire(),
        'entity_id': entityId,
        'operation': operation.toWire(),
        'payload': jsonEncode(syncPayload),
        'created_at': nowMs,
        'attempts': 0,
        'last_attempt_at': null,
        'last_error': null,
        'base_version': baseVersion,
        'status': SyncStatus.pending.toWire(),
        'priority': priority.toWire(),
      });
    });
  }

  /// Retrieve pending items ordered by priority (high first) then creation
  /// time, filtering out items still in their backoff window.
  Future<List<PendingSyncRow>> dequeueReady({String? tenantId}) async {
    final Database db = await _database.database;
    final int nowMs = _now().millisecondsSinceEpoch;

    final List<Map<String, Object?>> rows = await db.query(
      'pending_sync',
      where: tenantId == null
          ? "status = 'pending'"
          : "status = 'pending' AND tenant_id = ?",
      whereArgs: tenantId == null ? null : <Object>[tenantId],
      orderBy: 'priority ASC, created_at ASC, id ASC',
    );

    final List<PendingSyncRow> ready = <PendingSyncRow>[];
    for (final Map<String, Object?> raw in rows) {
      final PendingSyncRow row = PendingSyncRow.fromDb(raw);
      if (_isReadyForRetry(row, nowMs)) {
        ready.add(row);
      }
    }
    return ready;
  }

  /// Record a transient failure. Returns `true` if the item has exhausted
  /// its retry budget and been parked.
  Future<bool> recordFailure(PendingSyncRow row, String error) async {
    final Database db = await _database.database;
    final int newAttempts = row.attempts + 1;
    final bool exhausted = newAttempts >= maxRetries;

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

  /// Remove a successfully synced item from the queue.
  Future<void> remove(int rowId) async {
    final Database db = await _database.database;
    await db.delete('pending_sync', where: 'id = ?', whereArgs: <Object>[rowId]);
  }

  /// Get count of pending items by priority.
  Future<Map<SyncPriority, int>> countByPriority({String? tenantId}) async {
    final Database db = await _database.database;
    final String whereClause = tenantId == null
        ? "status = 'pending'"
        : "status = 'pending' AND tenant_id = ?";
    final List<Object>? whereArgs =
        tenantId == null ? null : <Object>[tenantId];

    final Map<SyncPriority, int> counts = <SyncPriority, int>{
      for (final SyncPriority p in SyncPriority.values) p: 0,
    };

    final List<Map<String, Object?>> rows = await db.rawQuery(
      'SELECT priority, COUNT(*) AS c FROM pending_sync '
      'WHERE $whereClause GROUP BY priority',
      whereArgs,
    );

    for (final Map<String, Object?> row in rows) {
      final String? rawPriority = row['priority'] as String?;
      final SyncPriority priority =
          SyncPriority.fromWire(rawPriority ?? 'normal');
      counts[priority] = (row['c'] as num?)?.toInt() ?? 0;
    }
    return counts;
  }

  /// Calculate the backoff duration for a given attempt using exponential
  /// backoff with jitter, capped at [maxBackoff].
  Duration calculateBackoff(int attempt) {
    if (attempt <= 0) return Duration.zero;
    final int exponentialMs =
        baseBackoff.inMilliseconds * (1 << (attempt - 1));
    final int cappedMs =
        math.min(exponentialMs, maxBackoff.inMilliseconds);
    // Add ±25% jitter to prevent thundering herd.
    final double jitter = 0.75 + (math.Random().nextDouble() * 0.5);
    return Duration(milliseconds: (cappedMs * jitter).round());
  }

  bool _isReadyForRetry(PendingSyncRow row, int nowMs) {
    if (row.attempts == 0 || row.lastAttemptAt == null) return true;
    final Duration backoff = calculateBackoff(row.attempts);
    return nowMs - row.lastAttemptAt! >= backoff.inMilliseconds;
  }

  String _requireTenantId() {
    final String? tenantId = _tenantProvider.tenantId;
    if (tenantId == null || tenantId.isEmpty) {
      throw StateError(
        'Cannot queue sync op without an active tenant.',
      );
    }
    return tenantId;
  }
}
