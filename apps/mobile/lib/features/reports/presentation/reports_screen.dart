import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:openemis_api_client/openemis_api_client.dart';

import '../../../core/di/injector.dart';
import '../../../core/sync/connectivity_monitor.dart';

/// Definition of a pre-configured report shown on `/reports`.
class ReportDefinition {
  const ReportDefinition({
    required this.id,
    required this.title,
    required this.description,
    required this.icon,
  });

  final String id;
  final String title;
  final String description;
  final IconData icon;
}

/// `/reports` route — lists pre-configured reports and server-generated
/// reports the mobile user can open. Each entry navigates to a detail screen.
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  static const List<ReportDefinition> reports = <ReportDefinition>[
    ReportDefinition(
      id: 'attendance-summary',
      title: 'Attendance summary',
      description: 'Daily attendance totals across the institution.',
      icon: Icons.fact_check_outlined,
    ),
    ReportDefinition(
      id: 'enrollment-summary',
      title: 'Enrollment summary',
      description: 'Enrollment counts grouped by class and grade.',
      icon: Icons.people_alt_outlined,
    ),
  ];

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  late final ConnectivityMonitor _connectivity;
  ReportApi? _reportApi;

  Future<List<ReportSummary>>? _serverReportsFuture;

  @override
  void initState() {
    super.initState();
    _connectivity = getIt<ConnectivityMonitor>();
    if (getIt.isRegistered<ReportApi>()) {
      _reportApi = getIt<ReportApi>();
    }
    _loadServerReports();
  }

  Future<void> _loadServerReports() async {
    if (_reportApi == null) return;
    if (!await _connectivity.isOnline()) return;
    setState(() {
      _serverReportsFuture = _reportApi!.listReports();
    });
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Reports')),
      body: RefreshIndicator(
        onRefresh: () async => _loadServerReports(),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: <Widget>[
            // Info banner — reports generate on the server.
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color: const Color(0xFF0EA5E9).withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: const Color(0xFF0EA5E9).withValues(alpha: 0.30),
                ),
              ),
              child: Row(
                children: <Widget>[
                  const Icon(
                    Icons.info_outline,
                    size: 18,
                    color: Color(0xFF0EA5E9),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Reports generate on the server and download as PDF.',
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.w600,
                        color: const Color(0xFF0EA5E9),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Pre-configured reports section.
            _SectionHeader(title: 'Quick reports'),
            const SizedBox(height: 8),
            _ReportCardGroup(
              children: <Widget>[
                for (final ReportDefinition report in ReportsScreen.reports)
                  _ReportTile(
                    icon: report.icon,
                    iconColor: theme.colorScheme.primary,
                    title: report.title,
                    subtitle: report.description,
                    onTap: () => context.push('/reports/${report.id}'),
                  ),
              ],
            ),
            const SizedBox(height: 20),

            // Server-generated reports section.
            _SectionHeader(title: 'Generated reports'),
            const SizedBox(height: 8),
            if (_serverReportsFuture == null)
              _ReportCardGroup(
                children: <Widget>[
                  _ReportEmptyTile(
                    icon: Icons.cloud_off_outlined,
                    text: 'Connect to the network to see generated reports.',
                  ),
                ],
              )
            else
              FutureBuilder<List<ReportSummary>>(
                future: _serverReportsFuture,
                builder: (BuildContext context,
                    AsyncSnapshot<List<ReportSummary>> snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const Padding(
                      padding: EdgeInsets.all(24),
                      child: Center(child: CircularProgressIndicator()),
                    );
                  }
                  if (snapshot.hasError) {
                    return _ReportCardGroup(
                      children: <Widget>[
                        _ReportEmptyTile(
                          icon: Icons.error_outline,
                          text: 'Failed to load reports.',
                          color: theme.colorScheme.error,
                        ),
                      ],
                    );
                  }
                  final List<ReportSummary> items =
                      snapshot.data ?? const <ReportSummary>[];
                  if (items.isEmpty) {
                    return _ReportCardGroup(
                      children: <Widget>[
                        _ReportEmptyTile(
                          icon: Icons.inbox_outlined,
                          text: 'No generated reports available.',
                        ),
                      ],
                    );
                  }
                  return _ReportCardGroup(
                    children: <Widget>[
                      for (final ReportSummary report in items)
                        _ReportTile(
                          icon: _iconForFormat(report.format),
                          iconColor: _colorForStatus(report.status),
                          title: report.title,
                          subtitle:
                              '${report.format.toUpperCase()} · ${report.status}',
                          trailing: _StatusPill(status: report.status),
                          onTap: () => context.push('/reports/${report.id}'),
                        ),
                    ],
                  );
                },
              ),
          ],
        ),
      ),
    );
  }

  IconData _iconForFormat(String format) {
    switch (format) {
      case 'pdf':
        return Icons.picture_as_pdf;
      case 'xlsx':
        return Icons.table_chart;
      case 'csv':
        return Icons.grid_on;
      default:
        return Icons.insert_drive_file;
    }
  }

  Color _colorForStatus(String status) {
    switch (status) {
      case 'completed':
        return const Color(0xFF10B981);
      case 'processing':
        return const Color(0xFF0EA5E9);
      case 'pending':
        return const Color(0xFFF59E0B);
      case 'failed':
        return const Color(0xFFEF4444);
      default:
        return const Color(0xFF64748B);
    }
  }
}

/// Uppercase, tracked section label.
class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Text(
      title.toUpperCase(),
      style: theme.textTheme.labelSmall?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: 0.6,
        color: theme.colorScheme.onSurfaceVariant,
      ),
    );
  }
}

/// A rounded card that vertically stacks report tiles with hairline dividers.
class _ReportCardGroup extends StatelessWidget {
  const _ReportCardGroup({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final List<Widget> rows = <Widget>[];
    for (int i = 0; i < children.length; i++) {
      if (i > 0) rows.add(const Divider(height: 1));
      rows.add(children[i]);
    }
    return Card(
      margin: EdgeInsets.zero,
      child: Column(children: rows),
    );
  }
}

/// A report row: tinted icon circle, title + subtitle, optional trailing.
class _ReportTile extends StatelessWidget {
  const _ReportTile({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.trailing,
  });

  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          children: <Widget>[
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: iconColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, size: 20, color: iconColor),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    title,
                    style: theme.textTheme.titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            if (trailing != null) ...<Widget>[
              trailing!,
              const SizedBox(width: 8),
            ],
            Icon(
              Icons.chevron_right,
              size: 20,
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ],
        ),
      ),
    );
  }
}

/// Placeholder/empty row inside a report card group.
class _ReportEmptyTile extends StatelessWidget {
  const _ReportEmptyTile({
    required this.icon,
    required this.text,
    this.color,
  });

  final IconData icon;
  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final Color tint = color ?? theme.colorScheme.onSurfaceVariant;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
      child: Row(
        children: <Widget>[
          Icon(icon, size: 20, color: tint),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              text,
              style: theme.textTheme.bodyMedium?.copyWith(color: tint),
            ),
          ),
        ],
      ),
    );
  }
}

/// Compact pill rendering a report status with the v2.0 status palette.
class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    Color color;
    switch (status) {
      case 'completed':
        color = const Color(0xFF10B981);
      case 'processing':
        color = const Color(0xFF0EA5E9);
      case 'pending':
        color = const Color(0xFFF59E0B);
      case 'failed':
        color = const Color(0xFFEF4444);
      default:
        color = const Color(0xFF64748B);
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        status.isEmpty
            ? status
            : status[0].toUpperCase() + status.substring(1),
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }
}
