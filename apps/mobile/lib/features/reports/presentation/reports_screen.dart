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
          children: <Widget>[
            // Pre-configured reports section.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text(
                'Quick Reports',
                style: theme.textTheme.titleSmall?.copyWith(
                  color: theme.colorScheme.primary,
                ),
              ),
            ),
            ...ReportsScreen.reports.map((ReportDefinition report) {
              return ListTile(
                leading: Icon(report.icon),
                title: Text(report.title),
                subtitle: Text(report.description),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/reports/${report.id}'),
              );
            }),
            const Divider(),
            // Server-generated reports section.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: Text(
                'Generated Reports',
                style: theme.textTheme.titleSmall?.copyWith(
                  color: theme.colorScheme.primary,
                ),
              ),
            ),
            if (_serverReportsFuture == null)
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text(
                  'Connect to the network to see generated reports.',
                  textAlign: TextAlign.center,
                ),
              )
            else
              FutureBuilder<List<ReportSummary>>(
                future: _serverReportsFuture,
                builder: (BuildContext context,
                    AsyncSnapshot<List<ReportSummary>> snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const Padding(
                      padding: EdgeInsets.all(16),
                      child: Center(child: CircularProgressIndicator()),
                    );
                  }
                  if (snapshot.hasError) {
                    return Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(
                        'Failed to load reports.',
                        style: TextStyle(color: theme.colorScheme.error),
                      ),
                    );
                  }
                  final List<ReportSummary> items =
                      snapshot.data ?? const <ReportSummary>[];
                  if (items.isEmpty) {
                    return const Padding(
                      padding: EdgeInsets.all(16),
                      child: Text(
                        'No generated reports available.',
                        textAlign: TextAlign.center,
                      ),
                    );
                  }
                  return Column(
                    children: items.map((ReportSummary report) {
                      return ListTile(
                        leading: Icon(_iconForFormat(report.format)),
                        title: Text(report.title),
                        subtitle: Text(
                          '${report.format.toUpperCase()} · ${report.status}',
                        ),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => context.push('/reports/${report.id}'),
                      );
                    }).toList(growable: false),
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
}
