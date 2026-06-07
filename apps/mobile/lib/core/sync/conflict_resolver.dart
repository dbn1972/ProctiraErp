import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:sqflite/sqflite.dart';

import '../storage/database.dart';
import 'sync_models.dart';

/// Resolution choice made by the user in the conflict dialog.
enum ConflictResolution {
  /// Keep the local (user's) version.
  keepLocal,

  /// Accept the server version.
  keepServer,
}

/// Handles sync conflict resolution with a user-facing dialog.
///
/// When the sync engine detects a 409 conflict, the conflicting row is stored
/// in `sync_conflicts`. This class provides:
/// - A dialog that shows local vs server values side-by-side.
/// - Resolution logic that applies the user's choice to the local cache.
class ConflictResolver {
  ConflictResolver({
    required AppDatabase database,
  }) : _database = database;

  final AppDatabase _database;

  /// Show a conflict resolution dialog and return the user's choice.
  ///
  /// Returns `null` if the user dismisses without choosing.
  Future<ConflictResolution?> showConflictDialog(
    BuildContext context,
    SyncConflict conflict,
  ) async {
    return showDialog<ConflictResolution>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext ctx) => _ConflictDialog(conflict: conflict),
    );
  }

  /// Apply the user's resolution to the database.
  ///
  /// - [ConflictResolution.keepLocal]: Re-queues the local payload for sync.
  /// - [ConflictResolution.keepServer]: Accepts server state (already applied
  ///   by the sync engine's server-wins default).
  ///
  /// In both cases the conflict row is removed from `sync_conflicts` and the
  /// corresponding `pending_sync` row (if still present) is cleaned up.
  Future<void> resolve(
    SyncConflict conflict,
    ConflictResolution resolution,
  ) async {
    final Database db = await _database.database;

    await db.transaction((Transaction txn) async {
      if (resolution == ConflictResolution.keepLocal) {
        // Re-queue the local payload as a new pending sync op so it will be
        // retried with the latest server version as the base.
        await txn.insert('pending_sync', <String, Object?>{
          'tenant_id': conflict.tenantId,
          'entity_type': conflict.entityType.toWire(),
          'entity_id': conflict.entityId,
          'operation': conflict.operation.toWire(),
          'payload': jsonEncode(conflict.localPayload),
          'created_at': DateTime.now().millisecondsSinceEpoch,
          'attempts': 0,
          'last_attempt_at': null,
          'last_error': null,
          'base_version': conflict.serverVersion,
          'status': SyncStatus.pending.toWire(),
          'priority': 'high',
        });
      }

      // Remove the conflict record.
      await txn.delete(
        'sync_conflicts',
        where: 'id = ?',
        whereArgs: <Object>[conflict.id],
      );

      // Clean up the original pending_sync row that was marked conflicted.
      await txn.delete(
        'pending_sync',
        where: "entity_id = ? AND tenant_id = ? AND status = 'conflicted'",
        whereArgs: <Object>[conflict.entityId, conflict.tenantId],
      );
    });
  }

  /// Resolve all conflicts with a batch strategy (e.g., "keep all server").
  Future<void> resolveAll(
    List<SyncConflict> conflicts,
    ConflictResolution resolution,
  ) async {
    for (final SyncConflict conflict in conflicts) {
      await resolve(conflict, resolution);
    }
  }
}

/// Dialog widget that displays local vs server values for a sync conflict.
class _ConflictDialog extends StatelessWidget {
  const _ConflictDialog({required this.conflict});

  final SyncConflict conflict;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final Map<String, dynamic> local = conflict.localPayload;
    final Map<String, dynamic>? server = conflict.serverPayload;

    // Collect all keys from both payloads.
    final Set<String> allKeys = <String>{
      ...local.keys,
      if (server != null) ...server.keys,
    };

    // Filter to only show differing fields.
    final List<String> diffKeys = allKeys.where((String key) {
      final dynamic localVal = local[key];
      final dynamic serverVal = server?[key];
      return localVal?.toString() != serverVal?.toString();
    }).toList()
      ..sort();

    return AlertDialog(
      title: Semantics(
        header: true,
        child: Text(
          'Conflict: ${conflict.entityType.name}',
          style: theme.textTheme.titleLarge,
        ),
      ),
      content: SizedBox(
        width: double.maxFinite,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(
              'Your changes conflict with updates on the server. '
              'Choose which version to keep.',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 16),
            Flexible(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 300),
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: diffKeys.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (BuildContext context, int index) {
                    final String key = diffKeys[index];
                    return _ConflictFieldRow(
                      fieldName: key,
                      localValue: local[key]?.toString() ?? '—',
                      serverValue: server?[key]?.toString() ?? '—',
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
      actions: <Widget>[
        Semantics(
          button: true,
          label: 'Keep server version',
          child: OutlinedButton.icon(
            onPressed: () =>
                Navigator.of(context).pop(ConflictResolution.keepServer),
            icon: const Icon(Icons.cloud_outlined),
            label: const Text('Keep server'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(48, 48),
            ),
          ),
        ),
        Semantics(
          button: true,
          label: 'Keep local version',
          child: FilledButton.icon(
            onPressed: () =>
                Navigator.of(context).pop(ConflictResolution.keepLocal),
            icon: const Icon(Icons.phone_android_outlined),
            label: const Text('Keep local'),
            style: FilledButton.styleFrom(
              minimumSize: const Size(48, 48),
            ),
          ),
        ),
      ],
      actionsAlignment: MainAxisAlignment.spaceBetween,
    );
  }
}

/// A single row in the conflict comparison table.
class _ConflictFieldRow extends StatelessWidget {
  const _ConflictFieldRow({
    required this.fieldName,
    required this.localValue,
    required this.serverValue,
  });

  final String fieldName;
  final String localValue;
  final String serverValue;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            fieldName,
            style: theme.textTheme.labelMedium?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Row(
            children: <Widget>[
              Expanded(
                child: Semantics(
                  label: 'Local value for $fieldName: $localValue',
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primaryContainer
                          .withValues(alpha: 0.3),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          'Local',
                          style: theme.textTheme.labelSmall,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          localValue,
                          style: theme.textTheme.bodySmall,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Semantics(
                  label: 'Server value for $fieldName: $serverValue',
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.tertiaryContainer
                          .withValues(alpha: 0.3),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          'Server',
                          style: theme.textTheme.labelSmall,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          serverValue,
                          style: theme.textTheme.bodySmall,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
