import 'package:flutter/material.dart';

import '../../../core/di/injector.dart';
import '../../../core/storage/database.dart';
import '../../../core/tenant/tenant_provider.dart';
import '../data/enrollment_repository.dart';

/// Lists every enrollment row known locally for the given student as a
/// vertical timeline, grouped by academic period. Renders without network.
class EnrollmentHistoryScreen extends StatefulWidget {
  const EnrollmentHistoryScreen({super.key, required this.studentId});

  final String studentId;

  @override
  State<EnrollmentHistoryScreen> createState() =>
      _EnrollmentHistoryScreenState();
}

class _EnrollmentHistoryScreenState extends State<EnrollmentHistoryScreen> {
  late final EnrollmentRepository _repository = EnrollmentRepository(
    database: getIt<AppDatabase>(),
    tenantProvider: getIt<TenantProvider>(),
  );
  late Future<Map<String, List<EnrollmentEntry>>> _future;

  @override
  void initState() {
    super.initState();
    _future = _repository.historyByPeriod(widget.studentId);
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme cs = theme.colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Enrollment history')),
      body: SafeArea(
        child: FutureBuilder<Map<String, List<EnrollmentEntry>>>(
          future: _future,
          builder: (BuildContext context,
              AsyncSnapshot<Map<String, List<EnrollmentEntry>>> snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return _StateMessage(
                icon: Icons.error_outline,
                title: 'Something went wrong',
                message: '${snapshot.error}',
              );
            }
            final Map<String, List<EnrollmentEntry>> grouped =
                snapshot.data ?? const <String, List<EnrollmentEntry>>{};
            if (grouped.isEmpty) {
              return const _StateMessage(
                icon: Icons.timeline_outlined,
                title: 'No enrollment records',
                message:
                    'No history cached for this student. Connect to the '
                    'network and refresh to populate the timeline.',
              );
            }

            // Flatten to a single chronological list while keeping period
            // labels as inline markers.
            final List<Widget> items = <Widget>[];
            final List<MapEntry<String, List<EnrollmentEntry>>> periods =
                grouped.entries.toList(growable: false);
            for (int p = 0; p < periods.length; p++) {
              final MapEntry<String, List<EnrollmentEntry>> period = periods[p];
              items.add(Padding(
                padding: EdgeInsets.only(top: p == 0 ? 0 : 22, bottom: 12),
                child: Text(
                  period.key,
                  style: theme.textTheme.titleMedium,
                ),
              ));
              for (int i = 0; i < period.value.length; i++) {
                final bool isLastOverall =
                    p == periods.length - 1 && i == period.value.length - 1;
                items.add(_TimelineTile(
                  entry: period.value[i],
                  isLast: isLastOverall,
                ));
              }
            }

            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
              children: <Widget>[
                ...items,
                const SizedBox(height: 20),
                Text(
                  'Records reflect the locally cached student registry.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: cs.onSurfaceVariant),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// One timeline row: a colored dot + connector line on the left, with the
/// enrollment title, status chip and date/exit meta on the right.
class _TimelineTile extends StatelessWidget {
  const _TimelineTile({required this.entry, required this.isLast});

  final EnrollmentEntry entry;
  final bool isLast;

  static const Color _green = Color(0xFF10B981);
  static const Color _amber = Color(0xFFF59E0B);
  static const Color _red = Color(0xFFEF4444);
  static const Color _sky = Color(0xFF0EA5E9);
  static const Color _slate = Color(0xFF64748B);

  Color get _statusColor {
    switch (entry.status?.toUpperCase()) {
      case 'ENROLLED':
      case 'ACTIVE':
        return _green;
      case 'TRANSFERRED':
      case 'PROMOTED':
        return _sky;
      case 'GRADUATED':
        return _amber;
      case 'WITHDRAWN':
      case 'EXITED':
        return _red;
      default:
        return _slate;
    }
  }

  String get _title =>
      entry.institutionName ?? entry.institutionId ?? 'Unknown institution';

  String get _meta {
    final String from = entry.enrolledAt ?? '?';
    final String to = entry.exitedAt ?? 'present';
    return '$from → $to';
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme cs = theme.colorScheme;
    final Color color = _statusColor;

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          // Dot + connector gutter.
          SizedBox(
            width: 28,
            child: Column(
              children: <Widget>[
                Container(
                  width: 16,
                  height: 16,
                  margin: const EdgeInsets.only(top: 4),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.18),
                    shape: BoxShape.circle,
                    border: Border.all(color: color, width: 2.5),
                  ),
                ),
                if (!isLast)
                  Expanded(
                    child: Container(
                      width: 2,
                      margin: const EdgeInsets.symmetric(vertical: 2),
                      color: theme.dividerColor,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          // Content card.
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : 14),
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: theme.cardColor,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: theme.dividerColor),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            _title,
                            style: theme.textTheme.bodyLarge
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                        ),
                        if (entry.status != null &&
                            entry.status!.isNotEmpty) ...<Widget>[
                          const SizedBox(width: 8),
                          _StatusChip(label: entry.status!, color: color),
                        ],
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _meta,
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: cs.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label.toUpperCase(),
        style: theme.textTheme.labelSmall
            ?.copyWith(color: color, fontWeight: FontWeight.w800),
      ),
    );
  }
}

class _StateMessage extends StatelessWidget {
  const _StateMessage({
    required this.icon,
    required this.title,
    required this.message,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme cs = theme.colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: 48, color: cs.onSurfaceVariant),
            const SizedBox(height: 16),
            Text(title, textAlign: TextAlign.center,
                style: theme.textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(
              message,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: cs.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}
