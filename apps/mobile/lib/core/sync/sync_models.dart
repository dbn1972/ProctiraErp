import 'dart:convert';

/// Logical entity buckets known to the sync engine. Each value lines up with a
/// row in `pending_sync.entity_type` and a typed dispatcher in [SyncEngine].
enum SyncEntityType {
  attendance,
  student,
  enrollment;

  String toWire() => name;

  static SyncEntityType fromWire(String value) {
    return SyncEntityType.values.firstWhere(
      (SyncEntityType v) => v.name == value,
      orElse: () => throw ArgumentError.value(value, 'SyncEntityType'),
    );
  }
}

/// Operation kinds the engine knows how to replay.
enum SyncOperation {
  create,
  update,
  delete;

  String toWire() => name;

  static SyncOperation fromWire(String value) {
    return SyncOperation.values.firstWhere(
      (SyncOperation v) => v.name == value,
      orElse: () => throw ArgumentError.value(value, 'SyncOperation'),
    );
  }
}

/// Lifecycle state of a queued op. `parked` rows are ones that exhausted their
/// retry budget; `conflicted` rows are server-rejected (409) writes awaiting
/// user reconciliation.
enum SyncStatus {
  pending,
  parked,
  conflicted;

  String toWire() => name;

  static SyncStatus fromWire(String value) {
    return SyncStatus.values.firstWhere(
      (SyncStatus v) => v.name == value,
      orElse: () => SyncStatus.pending,
    );
  }
}

/// Row in `pending_sync` together with already-decoded fields.
class PendingSyncRow {
  PendingSyncRow({
    required this.id,
    required this.tenantId,
    required this.entityType,
    required this.entityId,
    required this.operation,
    required this.payload,
    required this.attempts,
    required this.createdAt,
    required this.lastAttemptAt,
    required this.lastError,
    required this.baseVersion,
    required this.status,
  });

  final int id;
  final String tenantId;
  final SyncEntityType entityType;
  final String? entityId;
  final SyncOperation operation;
  final Map<String, dynamic> payload;
  final int attempts;
  final int createdAt;
  final int? lastAttemptAt;
  final String? lastError;
  final String? baseVersion;
  final SyncStatus status;

  factory PendingSyncRow.fromDb(Map<String, Object?> row) {
    final String rawPayload = row['payload'] as String;
    final Map<String, dynamic> decoded =
        (jsonDecode(rawPayload) as Map<String, dynamic>);
    return PendingSyncRow(
      id: (row['id'] as num).toInt(),
      tenantId: row['tenant_id'] as String,
      entityType: SyncEntityType.fromWire(row['entity_type'] as String),
      entityId: row['entity_id'] as String?,
      operation: SyncOperation.fromWire(row['operation'] as String),
      payload: decoded,
      attempts: (row['attempts'] as num).toInt(),
      createdAt: (row['created_at'] as num).toInt(),
      lastAttemptAt: row['last_attempt_at'] == null
          ? null
          : (row['last_attempt_at'] as num).toInt(),
      lastError: row['last_error'] as String?,
      baseVersion: row['base_version'] as String?,
      status: SyncStatus.fromWire(row['status'] as String? ?? 'pending'),
    );
  }
}

/// Snapshot of a row in `sync_conflicts`. Surfaced via
/// `SyncEngine.getConflicts()` so the UI can present the user with their local
/// edit alongside the server copy.
class SyncConflict {
  SyncConflict({
    required this.id,
    required this.tenantId,
    required this.entityType,
    required this.entityId,
    required this.operation,
    required this.localPayload,
    required this.serverPayload,
    required this.baseVersion,
    required this.serverVersion,
    required this.detectedAt,
  });

  final int id;
  final String tenantId;
  final SyncEntityType entityType;
  final String entityId;
  final SyncOperation operation;
  final Map<String, dynamic> localPayload;
  final Map<String, dynamic>? serverPayload;
  final String? baseVersion;
  final String? serverVersion;
  final int detectedAt;

  factory SyncConflict.fromDb(Map<String, Object?> row) {
    final Map<String, dynamic> local =
        jsonDecode(row['local_payload'] as String) as Map<String, dynamic>;
    final String? rawServer = row['server_payload'] as String?;
    return SyncConflict(
      id: (row['id'] as num).toInt(),
      tenantId: row['tenant_id'] as String,
      entityType: SyncEntityType.fromWire(row['entity_type'] as String),
      entityId: row['entity_id'] as String,
      operation: SyncOperation.fromWire(row['operation'] as String),
      localPayload: local,
      serverPayload: rawServer == null
          ? null
          : jsonDecode(rawServer) as Map<String, dynamic>,
      baseVersion: row['base_version'] as String?,
      serverVersion: row['server_version'] as String?,
      detectedAt: (row['detected_at'] as num).toInt(),
    );
  }
}

/// Outcome of a flush attempt. Useful for tests / status surfaces.
class SyncFlushResult {
  const SyncFlushResult({
    required this.processed,
    required this.synced,
    required this.failed,
    required this.conflicted,
    required this.parked,
  });

  final int processed;
  final int synced;
  final int failed;
  final int conflicted;
  final int parked;

  bool get hasIssues => failed > 0 || conflicted > 0 || parked > 0;
}
