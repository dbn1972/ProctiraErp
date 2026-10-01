import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import 'conflict_resolver.dart';
import 'sync_engine.dart';
import 'sync_models.dart';

/// Read/act surface over the offline queue used by [SyncStatusBanner].
/// Abstracted so widget tests can drive it without SQLite.
abstract class SyncStatusController {
  Stream<void> get changes;
  Future<SyncQueueSummary> summary();
  Future<int> retryParked();
  Future<List<SyncConflict>> conflicts();

  /// Show the keep-local / keep-server dialog for [conflict] and apply the
  /// choice. Returns false if the user dismissed the dialog.
  Future<bool> reviewConflict(BuildContext context, SyncConflict conflict);
}

/// Production controller backed by [SyncEngine] + [ConflictResolver].
class EngineSyncStatusController implements SyncStatusController {
  EngineSyncStatusController({
    required SyncEngine engine,
    required ConflictResolver resolver,
  }) : _engine = engine,
       _resolver = resolver;

  final SyncEngine _engine;
  final ConflictResolver _resolver;

  @override
  Stream<void> get changes => _engine.changes;

  @override
  Future<SyncQueueSummary> summary() => _engine.queueSummary();

  @override
  Future<int> retryParked() => _engine.retryParked();

  @override
  Future<List<SyncConflict>> conflicts() =>
      _engine.getConflicts(tenantId: _engine.activeTenantId);

  @override
  Future<bool> reviewConflict(
    BuildContext context,
    SyncConflict conflict,
  ) async {
    final ConflictResolution? choice = await _resolver.showConflictDialog(
      context,
      conflict,
    );
    if (choice == null) return false;
    await _resolver.resolve(conflict, choice);
    _engine.notifyQueueChanged();
    if (choice == ConflictResolution.keepLocal) _engine.requestFlush();
    return true;
  }
}

/// Offline queue status: waiting / failed (parked) / conflicted counts with
/// Retry and Review actions (PRC-H011). Renders nothing when the queue is
/// empty. Status is conveyed by icon + text, never colour alone.
class SyncStatusBanner extends StatefulWidget {
  const SyncStatusBanner({super.key, required this.controller});

  final SyncStatusController controller;

  @override
  State<SyncStatusBanner> createState() => _SyncStatusBannerState();
}

class _SyncStatusBannerState extends State<SyncStatusBanner> {
  SyncQueueSummary _summary = SyncQueueSummary.empty;
  StreamSubscription<void>? _sub;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _sub = widget.controller.changes.listen((_) => _refresh());
    _refresh();
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final SyncQueueSummary next = await widget.controller.summary();
      if (mounted) setState(() => _summary = next);
    } catch (_) {
      // Queue unavailable (e.g. logged out mid-refresh); keep last state.
    }
  }

  Future<void> _retry() async {
    setState(() => _busy = true);
    try {
      await widget.controller.retryParked();
    } finally {
      if (mounted) setState(() => _busy = false);
      await _refresh();
    }
  }

  Future<void> _review() async {
    setState(() => _busy = true);
    try {
      final List<SyncConflict> conflicts = await widget.controller.conflicts();
      for (final SyncConflict conflict in conflicts) {
        if (!mounted) break;
        final bool resolved = await widget.controller.reviewConflict(
          context,
          conflict,
        );
        if (!resolved) break;
      }
    } finally {
      if (mounted) setState(() => _busy = false);
      await _refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_summary.isEmpty) return const SizedBox.shrink();
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ColorScheme cs = Theme.of(context).colorScheme;
    final List<Widget> rows = <Widget>[
      if (_summary.conflicted > 0)
        _StatusRow(
          icon: Icons.report_outlined,
          background: cs.errorContainer,
          foreground: cs.onErrorContainer,
          title: l10n.syncConflictCount(_summary.conflicted),
          help: l10n.syncConflictHelp,
          actionLabel: l10n.reviewConflicts,
          onAction: _busy ? null : _review,
        ),
      if (_summary.parked > 0)
        _StatusRow(
          icon: Icons.sync_problem_outlined,
          background: cs.errorContainer,
          foreground: cs.onErrorContainer,
          title: l10n.syncFailedCount(_summary.parked),
          help: l10n.syncFailedHelp,
          actionLabel: l10n.retrySync,
          onAction: _busy ? null : _retry,
        ),
      if (_summary.pending > 0)
        _StatusRow(
          icon: Icons.cloud_upload_outlined,
          background: cs.secondaryContainer,
          foreground: cs.onSecondaryContainer,
          title: l10n.syncPendingCount(_summary.pending),
        ),
    ];
    return Semantics(
      container: true,
      liveRegion: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          for (final Widget row in rows)
            Padding(padding: const EdgeInsets.only(bottom: 8), child: row),
        ],
      ),
    );
  }
}

class _StatusRow extends StatelessWidget {
  const _StatusRow({
    required this.icon,
    required this.background,
    required this.foreground,
    required this.title,
    this.help,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final Color background;
  final Color foreground;
  final String title;
  final String? help;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    return Material(
      color: background,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
        child: Row(
          children: <Widget>[
            ExcludeSemantics(child: Icon(icon, color: foreground)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    title,
                    style: text.bodyMedium?.copyWith(
                      color: foreground,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (help != null)
                    Text(
                      help!,
                      style: text.bodySmall?.copyWith(color: foreground),
                    ),
                ],
              ),
            ),
            if (actionLabel != null)
              TextButton(
                onPressed: onAction,
                style: TextButton.styleFrom(
                  foregroundColor: foreground,
                  minimumSize: const Size(48, 48),
                ),
                child: Text(actionLabel!),
              ),
          ],
        ),
      ),
    );
  }
}

/// Per-row sync state for offline-first lists (e.g. the attendance roster).
/// Icon + text so the state is not conveyed by colour alone.
class SyncRowStateLabel extends StatelessWidget {
  const SyncRowStateLabel({
    super.key,
    required this.recorded,
    required this.synced,
    this.queueStatus,
  });

  /// Whether the row has a local value at all (e.g. a mark was taken).
  final bool recorded;
  final bool synced;

  /// Most severe queued-op state for the row, if any op is still queued.
  final SyncStatus? queueStatus;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final ColorScheme cs = theme.colorScheme;
    final (IconData? icon, String label, Color color) = !recorded
        ? (null, l10n.notMarked, cs.onSurfaceVariant)
        : switch (queueStatus) {
            SyncStatus.conflicted => (
              Icons.report_outlined,
              l10n.syncStatusConflict,
              cs.error,
            ),
            SyncStatus.parked => (
              Icons.sync_problem_outlined,
              l10n.syncStatusFailed,
              cs.error,
            ),
            SyncStatus.pending => (
              Icons.schedule_outlined,
              l10n.syncStatusSavedOnDevice,
              cs.onSurfaceVariant,
            ),
            null =>
              synced
                  ? (
                      Icons.cloud_done_outlined,
                      l10n.syncStatusSynced,
                      cs.onSurfaceVariant,
                    )
                  : (
                      Icons.schedule_outlined,
                      l10n.syncStatusSavedOnDevice,
                      cs.onSurfaceVariant,
                    ),
          };
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        if (icon != null) ...<Widget>[
          ExcludeSemantics(child: Icon(icon, size: 14, color: color)),
          const SizedBox(width: 4),
        ],
        Flexible(
          child: Text(
            label,
            style: theme.textTheme.bodySmall?.copyWith(color: color),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
