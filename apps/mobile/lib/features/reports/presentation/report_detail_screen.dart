import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:proctira_api_client/proctira_api_client.dart';

import '../../../core/di/injector.dart';
import '../../../core/sync/connectivity_monitor.dart';
import 'reports_screen.dart';

// v2.0 status palette.
const Color _green = Color(0xFF10B981);
const Color _amber = Color(0xFFF59E0B);
const Color _red = Color(0xFFEF4444);
const Color _sky = Color(0xFF0EA5E9);
const Color _slate = Color(0xFF64748B);

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
      _statusFuture = _reportApi!.getJobOrTemplate(widget.id);
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
      appBar: AppBar(title: const Text('Report')),
      body: report == null
          ? Center(
              child: Text(
                'Unknown report: ${widget.id}',
                style: theme.textTheme.bodyMedium,
              ),
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              children: <Widget>[
                _HeaderCard(
                  icon: report.icon,
                  iconColor: theme.colorScheme.primary,
                  title: report.title,
                  subtitle: report.description,
                ),
                const SizedBox(height: 16),
                Card(
                  margin: EdgeInsets.zero,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: widget.id == 'attendance-summary'
                        ? Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: <Widget>[
                              Text(
                                'Attendance totals are not embedded in this '
                                'shortcut. Open the attendance reports screen '
                                'to query GET /attendance/percentage.',
                                style: theme.textTheme.bodyMedium,
                              ),
                              const SizedBox(height: 12),
                              FilledButton.icon(
                                onPressed: () =>
                                    context.push('/attendance/reports'),
                                icon: const Icon(Icons.fact_check_outlined),
                                label: const Text('Open attendance reports'),
                              ),
                            ],
                          )
                        : Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: <Widget>[
                              Text(
                                'No enrollment summary endpoint is available '
                                'on the mobile gateway yet.',
                                style: theme.textTheme.bodyMedium,
                              ),
                              const SizedBox(height: 8),
                              Text(
                                'This shortcut stays as an honest empty state '
                                'until a dedicated API lands.',
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ),
                  ),
                ),
              ],
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
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: <Widget>[
        _HeaderCard(
          icon: _iconForFormat(report.format),
          iconColor: _colorForStatus(report.status),
          title: report.title,
          subtitle: report.description,
          trailing: _StatusPill(status: report.status),
        ),
        const SizedBox(height: 16),
        // Key figures — only the fields the model actually carries.
        _SectionHeader(title: 'Details'),
        const SizedBox(height: 8),
        Card(
          margin: EdgeInsets.zero,
          child: Column(
            children: <Widget>[
              _KeyFigureRow(
                icon: _iconForFormat(report.format),
                iconColor: _colorForStatus(report.status),
                label: 'Format',
                value: report.format.toUpperCase(),
              ),
              if (report.reportType != null) ...<Widget>[
                const Divider(height: 1),
                _KeyFigureRow(
                  icon: Icons.category_outlined,
                  iconColor: _sky,
                  label: report.isTemplate ? 'Template type' : 'Report type',
                  value: report.reportType!,
                ),
              ],
              if (report.rowCount != null) ...<Widget>[
                const Divider(height: 1),
                _KeyFigureRow(
                  icon: Icons.table_rows_outlined,
                  iconColor: _amber,
                  label: 'Rows',
                  value: '${report.rowCount}',
                ),
              ],
              if (report.createdAt != null) ...<Widget>[
                const Divider(height: 1),
                _KeyFigureRow(
                  icon: Icons.event_outlined,
                  iconColor: _sky,
                  label: 'Created',
                  value: report.createdAt!,
                ),
              ],
              if (report.completedAt != null) ...<Widget>[
                const Divider(height: 1),
                _KeyFigureRow(
                  icon: Icons.check_circle_outline,
                  iconColor: _green,
                  label: 'Completed',
                  value: report.completedAt!,
                ),
              ],
            ],
          ),
        ),
        if (report.errorMessage != null &&
            report.errorMessage!.isNotEmpty) ...<Widget>[
          const SizedBox(height: 12),
          Card(
            margin: EdgeInsets.zero,
            color: theme.colorScheme.errorContainer,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                report.errorMessage!,
                style: TextStyle(color: theme.colorScheme.onErrorContainer),
              ),
            ),
          ),
        ],
        const SizedBox(height: 16),
        if (!report.isTemplate && report.status == 'completed') ...<Widget>[
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
        if (!report.isTemplate &&
            (report.status == 'processing' || report.status == 'pending'))
          OutlinedButton.icon(
            onPressed: _loadStatus,
            icon: const Icon(Icons.refresh),
            label: const Text('Refresh Status'),
          ),
        if (!report.isTemplate && report.status == 'failed')
          Card(
            margin: EdgeInsets.zero,
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
        if (report.isTemplate)
          Text(
            'This is a report template definition. Generate a job from the '
            'web console to download output on mobile.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
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

  Color _colorForStatus(String status) {
    switch (status) {
      case 'completed':
        return _green;
      case 'processing':
        return _sky;
      case 'pending':
        return _amber;
      case 'failed':
        return _red;
      default:
        return _slate;
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

/// Header card: tinted icon square, title + subtitle, optional status pill.
class _HeaderCard extends StatelessWidget {
  const _HeaderCard({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    this.trailing,
  });

  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: <Widget>[
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: iconColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(icon, size: 22, color: iconColor),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    title,
                    style: theme.textTheme.titleMedium,
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
            if (trailing != null) ...<Widget>[
              const SizedBox(width: 8),
              trailing!,
            ],
          ],
        ),
      ),
    );
  }
}

/// A key-figure row: tinted icon circle, label, bold tabular value.
class _KeyFigureRow extends StatelessWidget {
  const _KeyFigureRow({
    required this.icon,
    required this.iconColor,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final Color iconColor;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: <Widget>[
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: iconColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 18, color: iconColor),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              label,
              style: theme.textTheme.titleSmall
                  ?.copyWith(fontWeight: FontWeight.w600),
            ),
          ),
          Text(
            value,
            style: theme.textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.w800,
              fontFeatures: const <FontFeature>[
                FontFeature.tabularFigures(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Compact status pill using the v2.0 status palette.
class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    Color color;
    switch (status) {
      case 'completed':
        color = _green;
      case 'processing':
        color = _sky;
      case 'pending':
        color = _amber;
      case 'failed':
        color = _red;
      default:
        color = _slate;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        status.isEmpty
            ? status
            : status[0].toUpperCase() + status.substring(1),
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }
}
