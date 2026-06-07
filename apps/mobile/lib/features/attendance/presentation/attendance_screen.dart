import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:openemis_api_client/openemis_api_client.dart';

import '../../../core/auth/auth_bloc.dart';
import '../../../core/di/injector.dart';
import '../../../core/storage/database.dart';
import '../../../core/sync/sync_engine.dart';
import '../../../core/tenant/tenant_provider.dart';
import '../data/attendance_repository.dart';
import 'attendance_geofence_widget.dart';

/// Offline-first attendance marking screen.
///
/// Workflow:
/// 1. The user enters an institution id, optional class, and date.
/// 2. The screen loads the roster from `students_cache` (or the API when the
///    cache is empty), merges in any existing offline marks for that date,
///    and displays a geofence banner.
/// 3. Each tap of a status chip queues a sync op via [SyncEngine] and updates
///    the local cache immediately so the row appears as recorded even when
///    the device is offline.
class AttendanceScreen extends StatefulWidget {
  const AttendanceScreen({super.key});

  @override
  State<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends State<AttendanceScreen> {
  final TextEditingController _institutionCtrl = TextEditingController();
  final TextEditingController _classCtrl = TextEditingController();
  DateTime _date = DateTime.now();
  bool _loading = false;
  String? _loadError;
  List<AttendanceRosterEntry> _roster = const <AttendanceRosterEntry>[];
  GeofenceCheck? _lastCheck;

  late final AttendanceRepository _repository = AttendanceRepository(
    database: getIt<AppDatabase>(),
    tenantProvider: getIt<TenantProvider>(),
    syncEngine: getIt<SyncEngine>(),
    studentApi: getIt<StudentApi>(),
  );
  late final GeofenceLocator _locator = buildAppGeofenceLocator();

  String get _dateString => DateFormat('yyyy-MM-dd').format(_date);

  @override
  void dispose() {
    _institutionCtrl.dispose();
    _classCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final DateTime now = DateTime.now();
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(now.year - 5),
      // Requirement 9.1 / 9.7: future attendance is rejected by the server,
      // surface the same constraint in the UI.
      lastDate: now,
    );
    if (picked != null) {
      setState(() => _date = picked);
    }
  }

  Future<void> _loadRoster() async {
    final String institution = _institutionCtrl.text.trim();
    if (institution.isEmpty) {
      setState(() {
        _loadError = 'Enter an institution id to load the roster.';
        _roster = const <AttendanceRosterEntry>[];
      });
      return;
    }
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final List<AttendanceRosterEntry> roster = await _repository.loadRoster(
        institutionId: institution,
        classId: _classCtrl.text.trim().isEmpty ? null : _classCtrl.text.trim(),
        date: _dateString,
      );
      if (!mounted) return;
      setState(() {
        _roster = roster;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadError = 'Unable to load roster: $error';
        _loading = false;
      });
    }
  }

  Future<void> _mark(
    AttendanceRosterEntry entry,
    AttendanceStatus status, {
    String? comment,
  }) async {
    final AuthState auth = getIt<AuthBloc>().state;
    final String recordedBy = auth.userId ?? 'mobile-user';

    try {
      final AttendanceRosterEntry saved = await _repository.markAttendance(
        entry: entry,
        institutionId: _institutionCtrl.text.trim(),
        classId: _classCtrl.text.trim().isEmpty ? null : _classCtrl.text.trim(),
        date: _dateString,
        status: status,
        recordedBy: recordedBy,
        comment: comment,
        latitude: _lastCheck?.userPosition?.latitude,
        longitude: _lastCheck?.userPosition?.longitude,
      );
      if (!mounted) return;
      setState(() {
        _roster = _roster.map((AttendanceRosterEntry e) {
          if (e.studentId == saved.studentId) {
            return AttendanceRosterEntry(
              studentId: e.studentId,
              studentName: e.studentName,
              recordId: saved.recordId,
              status: saved.status,
              comment: saved.comment,
              version: saved.version,
              synced: false,
            );
          }
          return e;
        }).toList(growable: false);
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          duration: const Duration(seconds: 2),
          content: Text('Marked ${entry.studentName} as ${status.toWire()}'),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to save: $error')),
      );
    }
  }

  Future<String?> _promptComment(AttendanceRosterEntry entry) async {
    final TextEditingController ctrl =
        TextEditingController(text: entry.comment ?? '');
    final String? value = await showDialog<String>(
      context: context,
      builder: (BuildContext ctx) => AlertDialog(
        title: Text('Comment for ${entry.studentName}'),
        content: TextField(
          controller: ctrl,
          maxLines: 3,
          decoration: const InputDecoration(hintText: 'Optional comment'),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    ctrl.dispose();
    return value;
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Attendance')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              TextField(
                controller: _institutionCtrl,
                decoration: const InputDecoration(
                  labelText: 'Institution ID',
                  prefixIcon: Icon(Icons.school_outlined),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: <Widget>[
                  Expanded(
                    child: TextField(
                      controller: _classCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Class (optional)',
                        prefixIcon: Icon(Icons.groups_outlined),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: InputDecorator(
                      decoration: const InputDecoration(
                        labelText: 'Date',
                        prefixIcon: Icon(Icons.calendar_today_outlined),
                      ),
                      child: InkWell(
                        onTap: _pickDate,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          child: Text(_dateString),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _loading ? null : _loadRoster,
                icon: const Icon(Icons.refresh),
                label: Text(_loading ? 'Loading…' : 'Load roster'),
              ),
              if (_institutionCtrl.text.trim().isNotEmpty)
                AttendanceGeofenceWidget(
                  institutionId: _institutionCtrl.text.trim(),
                  locator: _locator,
                  onCheck: (GeofenceCheck check) =>
                      _lastCheck = check,
                ),
              const SizedBox(height: 8),
              if (_loadError != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    _loadError!,
                    style: theme.textTheme.bodyMedium
                        ?.copyWith(color: theme.colorScheme.error),
                  ),
                ),
              Expanded(
                child: _roster.isEmpty
                    ? Center(
                        child: Text(
                          _loading
                              ? 'Loading roster…'
                              : 'Roster is empty. Load students from the cache or sync online.',
                          style: theme.textTheme.bodyMedium,
                          textAlign: TextAlign.center,
                        ),
                      )
                    : ListView.separated(
                        itemBuilder: (BuildContext context, int index) =>
                            _RosterRow(
                          entry: _roster[index],
                          onMark: (AttendanceStatus status) =>
                              _mark(_roster[index], status),
                          onComment: () async {
                            final String? comment = await _promptComment(
                              _roster[index],
                            );
                            if (comment != null) {
                              await _mark(
                                _roster[index],
                                _roster[index].status ?? AttendanceStatus.present,
                                comment: comment,
                              );
                            }
                          },
                        ),
                        separatorBuilder: (_, _) => const Divider(height: 0),
                        itemCount: _roster.length,
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RosterRow extends StatelessWidget {
  const _RosterRow({
    required this.entry,
    required this.onMark,
    required this.onComment,
  });

  final AttendanceRosterEntry entry;
  final void Function(AttendanceStatus status) onMark;
  final VoidCallback onComment;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  entry.studentName,
                  style: theme.textTheme.titleMedium,
                ),
              ),
              if (entry.status != null)
                Chip(
                  label: Text(entry.status!.toWire()),
                  backgroundColor: _statusColor(theme, entry.status!),
                ),
              IconButton(
                icon: const Icon(Icons.comment_outlined),
                tooltip: 'Add comment',
                onPressed: onComment,
              ),
            ],
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 8,
            children: AttendanceStatus.values.map((AttendanceStatus s) {
              final bool selected = entry.status == s;
              return ChoiceChip(
                label: Text(s.toWire()),
                selected: selected,
                onSelected: (_) => onMark(s),
              );
            }).toList(growable: false),
          ),
          if (entry.comment != null && entry.comment!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                'Comment: ${entry.comment}',
                style: theme.textTheme.bodySmall,
              ),
            ),
        ],
      ),
    );
  }

  Color _statusColor(ThemeData theme, AttendanceStatus status) {
    switch (status) {
      case AttendanceStatus.present:
        return theme.colorScheme.primaryContainer;
      case AttendanceStatus.absent:
        return theme.colorScheme.errorContainer;
      case AttendanceStatus.late:
        return theme.colorScheme.tertiaryContainer;
      case AttendanceStatus.excused:
        return theme.colorScheme.secondaryContainer;
    }
  }
}
