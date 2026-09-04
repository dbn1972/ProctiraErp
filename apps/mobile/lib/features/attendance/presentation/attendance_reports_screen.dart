import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:sqflite/sqflite.dart';

import '../../../core/di/injector.dart';
import '../../../core/storage/database.dart';
import '../../../core/tenant/tenant_provider.dart';

/// Attendance percentage summary from `GET /api/v1/attendance/percentage`
/// or a local offline cache rollup.
class AttendanceReportSummary {
  const AttendanceReportSummary({
    required this.scope,
    required this.totalRecords,
    required this.presentCount,
    required this.absentCount,
    required this.excusedCount,
    required this.lateCount,
    required this.attendancePercentage,
    required this.absencePercentage,
    this.source = 'api',
  });

  final String scope;
  final int totalRecords;
  final int presentCount;
  final int absentCount;
  final int excusedCount;
  final int lateCount;
  final double attendancePercentage;
  final double absencePercentage;
  final String source;

  factory AttendanceReportSummary.fromJson(Map<String, dynamic> json) {
    return AttendanceReportSummary(
      scope: (json['scope'] as String?) ?? 'unknown',
      totalRecords: (json['totalRecords'] as num?)?.toInt() ?? 0,
      presentCount: (json['presentCount'] as num?)?.toInt() ?? 0,
      absentCount: (json['absentCount'] as num?)?.toInt() ?? 0,
      excusedCount: (json['excusedCount'] as num?)?.toInt() ?? 0,
      lateCount: (json['lateCount'] as num?)?.toInt() ?? 0,
      attendancePercentage:
          (json['attendancePercentage'] as num?)?.toDouble() ?? 0,
      absencePercentage: (json['absencePercentage'] as num?)?.toDouble() ?? 0,
    );
  }
}

/// Dedicated attendance reports screen backed by the attendance percentage API
/// (with an honest offline empty / local-cache fallback).
class AttendanceReportsScreen extends StatefulWidget {
  const AttendanceReportsScreen({super.key});

  @override
  State<AttendanceReportsScreen> createState() =>
      _AttendanceReportsScreenState();
}

class _AttendanceReportsScreenState extends State<AttendanceReportsScreen> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _institutionCtrl = TextEditingController();
  final TextEditingController _classCtrl = TextEditingController();
  final TextEditingController _studentCtrl = TextEditingController();

  String _scope = 'institution';
  late String _startDate;
  late String _endDate;
  bool _loading = false;
  String? _error;
  AttendanceReportSummary? _summary;

  @override
  void initState() {
    super.initState();
    final DateTime now = DateTime.now();
    final DateTime start = now.subtract(const Duration(days: 30));
    _endDate = _fmt(now);
    _startDate = _fmt(start);
  }

  @override
  void dispose() {
    _institutionCtrl.dispose();
    _classCtrl.dispose();
    _studentCtrl.dispose();
    super.dispose();
  }

  String _fmt(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _pickDate({required bool isStart}) async {
    final DateTime initial = DateTime.tryParse(isStart ? _startDate : _endDate) ??
        DateTime.now();
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked == null) return;
    setState(() {
      if (isStart) {
        _startDate = _fmt(picked);
      } else {
        _endDate = _fmt(picked);
      }
    });
  }

  Future<void> _load() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _loading = true;
      _error = null;
      _summary = null;
    });

    final Dio dio = getIt<Dio>();
    final Map<String, dynamic> query = <String, dynamic>{
      'scope': _scope,
      'startDate': _startDate,
      'endDate': _endDate,
      if (_scope == 'institution' || _scope == 'student')
        'institutionId': _institutionCtrl.text.trim(),
      if (_scope == 'class' || _scope == 'student')
        'classId': _classCtrl.text.trim(),
      if (_scope == 'student') 'studentId': _studentCtrl.text.trim(),
    };

    try {
      final Response<dynamic> response = await dio.get(
        '/api/v1/attendance/percentage',
        queryParameters: query,
      );
      final Object? body = response.data;
      if (body is Map) {
        setState(() {
          _summary = AttendanceReportSummary.fromJson(
            Map<String, dynamic>.from(body),
          );
          _loading = false;
        });
        return;
      }
      throw const FormatException('Unexpected attendance report response');
    } on DioException catch (error) {
      final AttendanceReportSummary? local = await _loadLocalFallback();
      if (!mounted) return;
      if (local != null && local.totalRecords > 0) {
        setState(() {
          _summary = local;
          _loading = false;
          _error =
              'Showing offline marks for this tenant (API unavailable).';
        });
        return;
      }
      setState(() {
        _loading = false;
        _error = error.response?.data is Map &&
                (error.response!.data as Map)['message'] is String
            ? (error.response!.data as Map)['message'] as String
            : 'Unable to load attendance report.';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  Future<AttendanceReportSummary?> _loadLocalFallback() async {
    final String? tenantId = getIt<TenantProvider>().tenantId;
    if (tenantId == null || tenantId.isEmpty) return null;
    final Database db = await getIt<AppDatabase>().database;
    final List<Map<String, Object?>> rows = await db.query(
      'attendance_offline',
      where: 'tenant_id = ? AND attendance_date >= ? AND attendance_date <= ?',
      whereArgs: <Object>[tenantId, _startDate, _endDate],
    );
    if (rows.isEmpty) return null;

    int present = 0;
    int absent = 0;
    int excused = 0;
    int late = 0;
    for (final Map<String, Object?> row in rows) {
      switch ((row['status'] as String?)?.toUpperCase()) {
        case 'PRESENT':
          present++;
        case 'ABSENT':
          absent++;
        case 'EXCUSED':
          excused++;
        case 'LATE':
          late++;
      }
    }
    final int total = rows.length;
    final double pct =
        total == 0 ? 0 : ((present + late) / total * 100);
    final double absentPct = total == 0 ? 0 : (absent / total * 100);
    return AttendanceReportSummary(
      scope: 'local',
      totalRecords: total,
      presentCount: present,
      absentCount: absent,
      excusedCount: excused,
      lateCount: late,
      attendancePercentage: double.parse(pct.toStringAsFixed(2)),
      absencePercentage: double.parse(absentPct.toStringAsFixed(2)),
      source: 'offline',
    );
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Attendance reports')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: <Widget>[
          Text(
            'Attendance summary',
            style: theme.textTheme.titleLarge,
          ),
          const SizedBox(height: 4),
          Text(
            'Uses GET /attendance/percentage when online. Offline marks on '
            'this device are used only as a fallback.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 16),
          Form(
            key: _formKey,
            child: Column(
              children: <Widget>[
                DropdownButtonFormField<String>(
                  key: ValueKey<String>(_scope),
                  initialValue: _scope,
                  decoration: const InputDecoration(
                    labelText: 'Scope',
                    prefixIcon: Icon(Icons.filter_alt_outlined),
                  ),
                  items: const <DropdownMenuItem<String>>[
                    DropdownMenuItem(value: 'institution', child: Text('Institution')),
                    DropdownMenuItem(value: 'class', child: Text('Class')),
                    DropdownMenuItem(value: 'student', child: Text('Student')),
                  ],
                  onChanged: (String? value) {
                    if (value == null) return;
                    setState(() => _scope = value);
                  },
                ),
                const SizedBox(height: 12),
                if (_scope == 'institution' || _scope == 'student')
                  TextFormField(
                    controller: _institutionCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Institution ID',
                      prefixIcon: Icon(Icons.school_outlined),
                    ),
                    validator: (String? v) {
                      if ((_scope == 'institution' || _scope == 'student') &&
                          (v == null || v.trim().isEmpty)) {
                        return 'Institution ID is required';
                      }
                      return null;
                    },
                  ),
                if (_scope == 'class' || _scope == 'student') ...<Widget>[
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _classCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Class ID',
                      prefixIcon: Icon(Icons.groups_outlined),
                    ),
                    validator: (String? v) {
                      if ((_scope == 'class' || _scope == 'student') &&
                          (v == null || v.trim().isEmpty)) {
                        return 'Class ID is required';
                      }
                      return null;
                    },
                  ),
                ],
                if (_scope == 'student') ...<Widget>[
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _studentCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Student ID',
                      prefixIcon: Icon(Icons.person_outline),
                    ),
                    validator: (String? v) {
                      if (_scope == 'student' &&
                          (v == null || v.trim().isEmpty)) {
                        return 'Student ID is required';
                      }
                      return null;
                    },
                  ),
                ],
                const SizedBox(height: 12),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => _pickDate(isStart: true),
                        icon: const Icon(Icons.date_range),
                        label: Text('From $_startDate'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => _pickDate(isStart: false),
                        icon: const Icon(Icons.event),
                        label: Text('To $_endDate'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: _loading ? null : _load,
                  icon: _loading
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.bar_chart),
                  label: Text(_loading ? 'Loading…' : 'Load report'),
                ),
              ],
            ),
          ),
          if (_error != null) ...<Widget>[
            const SizedBox(height: 16),
            Text(
              _error!,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.error,
              ),
            ),
          ],
          if (_summary != null) ...<Widget>[
            const SizedBox(height: 20),
            _SummaryCard(summary: _summary!),
          ],
        ],
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.summary});

  final AttendanceReportSummary summary;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    'Scope: ${summary.scope}',
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                Text(
                  summary.source == 'offline' ? 'Offline' : 'API',
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              '${summary.attendancePercentage.toStringAsFixed(2)}% attendance',
              style: theme.textTheme.headlineSmall?.copyWith(
                color: const Color(0xFF10B981),
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              '${summary.absencePercentage.toStringAsFixed(2)}% absence · '
              '${summary.totalRecords} records',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 16),
            Table(
              border: TableBorder.all(
                color: theme.colorScheme.outlineVariant,
                borderRadius: BorderRadius.circular(12),
              ),
              columnWidths: const <int, TableColumnWidth>{
                0: FlexColumnWidth(2),
                1: FlexColumnWidth(1),
              },
              children: <TableRow>[
                _row('Status', 'Count', header: true),
                _row('Present', '${summary.presentCount}'),
                _row('Absent', '${summary.absentCount}'),
                _row('Late', '${summary.lateCount}'),
                _row('Excused', '${summary.excusedCount}'),
              ],
            ),
          ],
        ),
      ),
    );
  }

  TableRow _row(String a, String b, {bool header = false}) {
    return TableRow(
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Text(
            a,
            style: header ? const TextStyle(fontWeight: FontWeight.w700) : null,
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Text(
            b,
            style: header ? const TextStyle(fontWeight: FontWeight.w700) : null,
          ),
        ),
      ],
    );
  }
}
