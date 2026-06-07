import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:openemis_api_client/openemis_api_client.dart';

import '../../../core/di/injector.dart';
import '../../../core/sync/connectivity_monitor.dart';
import 'reports_screen.dart';

/// `/reports/:id` route — shows report details with status tracking and
/// download capability. For pre-configured reports (attendance-summary,
/// enrollment-summary) it shows a placeholder table. For server-generated
/// reports it fetches status from the API and offers a download button.
class ReportDetailScreen extends StatefulWidget {
  const ReportDetailScreen({super.key, required this.id});

  final String id;

  @override
  State<ReportDetailScreen> createState() => _ReportDetailScreenState();
}

class _ReportDetailScreenState extends State<ReportDetailScreen> {
  late final ConnectivityMonitor _connectivity;
  ReportApi? _reportApi;

  Future<ReportSummary>? _statusFuture;
  bool _downloading = false;
  String? _downloadError;

  @override
  void initState() {
    super.initState();
    _connectivity = getIt<ConnectivityMonitor>();
    if (getIt.isRegistered<ReportApi>()) {
      _reportApi = getIt<ReportApi>();
    }
    _loadStatus();
  }

  Future<void> _loadStatus() async {
    // Only fetch from API for non-predefined reports.
    if (_isPredefined) return;
    if (_reportApi == null) return;
    if (!await _connectivity.isOnline()) return;
    setState(() {
      _statusFuture = _reportApi!.getReportStatus(widget.id);
    });
  }

  bool get _isPredefined =>
      ReportsScreen.reports.any(
        (ReportDefinition r) => r.id == widget.id,
      );

  Future<void> _downloadReport() async {
    if (_reportApi == null) return;
    setState(() {
      _downloading = true;
      _downloadError = null;
    });
    try {
      final Uint8List bytes = await _reportApi!.downloadReport(widget.id);
      if (!mounted) return;
      setState(() => _downloading = false);
      if (bytes.isEmpty) {
        setState(() => _downloadError = 'Report file is empty.');
        return;
      }
      // Show a success snackbar. In a production app this would save to
      // device storage or open a share sheet.
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Downloaded ${bytes.length} bytes'),
          action: SnackBarAction(label: 'OK', onPressed: () {}),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _downloading = false;
        _downloadError = error.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    // For predefined reports, show the placeholder view.
    if (_isPredefined) {
      return _buildPredefinedReport(theme);
    }

    // For server-generated reports, show status + download.
    return _buildServerReport(theme);
  }

  Widget _buildPredefinedReport(ThemeData theme) {
    ReportDefinition? report;
    for (final ReportDefinition r in ReportsScreen.reports) {
      if (r.id == widget.id) {
        report = r;
        break;
      }
    }

    return Scaffold(
      appBar: AppBar(title: Text(report?.title ?? 'Report')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: report == null
            ? Center(
                child: Text(
                  'Unknown report: ${widget.id}',
                  style: theme.textTheme.bodyMedium,
                ),
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: <Widget>[
                          Icon(report.icon,
                              size: 36, color: theme.colorScheme.primary),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Text(report.title,
                                    style: theme.textTheme.titleMedium),
                                Text(
                                  report.description,
                                  style: theme.textTheme.bodySmall,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Expanded(
                    child: Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: widget.id == 'attendance-summary'
                            ? const _AttendanceSummaryPlaceholder()
                            : const _EnrollmentSummaryPlaceholder(),
                      ),
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  Widget _buildServerReport(ThemeData theme) {
    return Scaffold(
      appBar: AppBar(title: const Text('Report')),
      body: _statusFuture == null
          ? _buildOfflineState(theme)
          : FutureBuilder<ReportSummary>(
              future: _statusFuture,
              builder: (BuildContext context,
                  AsyncSnapshot<ReportSummary> snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          const Icon(Icons.error_outline, size: 48),
                          const SizedBox(height: 12),
                          Text(
                            'Failed to load report status.',
                            style: theme.textTheme.titleMedium,
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '${snapshot.error}',
                            style: theme.textTheme.bodySmall,
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 16),
                          FilledButton.icon(
                            onPressed: _loadStatus,
                            icon: const Icon(Icons.refresh),
                            label: const Text('Retry'),
                          ),
                        ],
                      ),
                    ),
                  );
                }
                final ReportSummary report = snapshot.data!;
                return _buildReportDetails(theme, report);
              },
            ),
    );
  }

  Widget _buildOfflineState(ThemeData theme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(Icons.cloud_off, size: 48),
            const SizedBox(height: 12),
            Text(
              'Report details require an internet connection.',
              style: theme.textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _loadStatus,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildReportDetails(ThemeData theme, ReportSummary report) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Icon(
                      _iconForFormat(report.format),
                      size: 36,
                      color: theme.colorScheme.primary,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(report.title,
                              style: theme.textTheme.titleMedium),
                          Text(
                            report.description,
                            style: theme.textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('Status', style: theme.textTheme.titleSmall),
                const SizedBox(height: 8),
                _StatusChip(status: report.status),
                const SizedBox(height: 12),
                _DetailRow(
                  label: 'Format',
                  value: report.format.toUpperCase(),
                ),
                if (report.createdAt != null)
                  _DetailRow(label: 'Created', value: report.createdAt!),
                if (report.completedAt != null)
                  _DetailRow(label: 'Completed', value: report.completedAt!),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        if (report.status == 'completed') ...<Widget>[
          FilledButton.icon(
            onPressed: _downloading ? null : _downloadReport,
            icon: _downloading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.download),
            label: Text(_downloading ? 'Downloading...' : 'Download Report'),
          ),
          if (_downloadError != null) ...<Widget>[
            const SizedBox(height: 8),
            Text(
              _downloadError!,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.error,
              ),
            ),
          ],
        ],
        if (report.status == 'processing' || report.status == 'pending')
          OutlinedButton.icon(
            onPressed: _loadStatus,
            icon: const Icon(Icons.refresh),
            label: const Text('Refresh Status'),
          ),
        if (report.status == 'failed')
          Card(
            color: theme.colorScheme.errorContainer,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: <Widget>[
                  Icon(Icons.error, color: theme.colorScheme.onErrorContainer),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Report generation failed. Please try again later.',
                      style: TextStyle(
                        color: theme.colorScheme.onErrorContainer,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
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

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    Color backgroundColor;
    Color textColor;
    IconData icon;

    switch (status) {
      case 'completed':
        backgroundColor = Colors.green.shade50;
        textColor = Colors.green.shade800;
        icon = Icons.check_circle;
      case 'processing':
        backgroundColor = Colors.blue.shade50;
        textColor = Colors.blue.shade800;
        icon = Icons.hourglass_top;
      case 'pending':
        backgroundColor = Colors.orange.shade50;
        textColor = Colors.orange.shade800;
        icon = Icons.schedule;
      case 'failed':
        backgroundColor = Colors.red.shade50;
        textColor = Colors.red.shade800;
        icon = Icons.cancel;
      default:
        backgroundColor = Colors.grey.shade100;
        textColor = Colors.grey.shade800;
        icon = Icons.help_outline;
    }

    return Chip(
      avatar: Icon(icon, color: textColor, size: 18),
      label: Text(
        status[0].toUpperCase() + status.substring(1),
        style: TextStyle(color: textColor),
      ),
      backgroundColor: backgroundColor,
      side: BorderSide.none,
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: <Widget>[
          SizedBox(
            width: 90,
            child: Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(
            child: Text(value, style: theme.textTheme.bodyMedium),
          ),
        ],
      ),
    );
  }
}

class _AttendanceSummaryPlaceholder extends StatelessWidget {
  const _AttendanceSummaryPlaceholder();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text('Today', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Table(
          border: TableBorder.all(
            color: Theme.of(context).colorScheme.outlineVariant,
          ),
          columnWidths: const <int, TableColumnWidth>{
            0: FlexColumnWidth(2),
            1: FlexColumnWidth(1),
          },
          children: const <TableRow>[
            TableRow(children: <Widget>[
              _Cell('Status', isHeader: true),
              _Cell('Count', isHeader: true),
            ]),
            TableRow(children: <Widget>[_Cell('Present'), _Cell('—')]),
            TableRow(children: <Widget>[_Cell('Absent'), _Cell('—')]),
            TableRow(children: <Widget>[_Cell('Late'), _Cell('—')]),
            TableRow(children: <Widget>[_Cell('Excused'), _Cell('—')]),
          ],
        ),
        const SizedBox(height: 12),
        Text(
          'Live data will populate once the attendance report API is wired up.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}

class _EnrollmentSummaryPlaceholder extends StatelessWidget {
  const _EnrollmentSummaryPlaceholder();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text('By grade', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Table(
          border: TableBorder.all(
            color: Theme.of(context).colorScheme.outlineVariant,
          ),
          columnWidths: const <int, TableColumnWidth>{
            0: FlexColumnWidth(2),
            1: FlexColumnWidth(1),
          },
          children: const <TableRow>[
            TableRow(children: <Widget>[
              _Cell('Grade', isHeader: true),
              _Cell('Students', isHeader: true),
            ]),
            TableRow(children: <Widget>[_Cell('Grade 1'), _Cell('—')]),
            TableRow(children: <Widget>[_Cell('Grade 2'), _Cell('—')]),
            TableRow(children: <Widget>[_Cell('Grade 3'), _Cell('—')]),
          ],
        ),
        const SizedBox(height: 12),
        Text(
          'Live data will populate once the enrollment report API is wired up.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}

class _Cell extends StatelessWidget {
  const _Cell(this.text, {this.isHeader = false});
  final String text;
  final bool isHeader;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Text(
        text,
        style: isHeader
            ? const TextStyle(fontWeight: FontWeight.w600)
            : null,
      ),
    );
  }
}
