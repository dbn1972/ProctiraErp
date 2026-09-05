import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:proctira_api_client/proctira_api_client.dart';

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

  // v2.0 status palette.
  static const Color _presentColor = Color(0xFF10B981);
  static const Color _absentColor = Color(0xFFEF4444);
  static const Color _lateColor = Color(0xFFF59E0B);

  Future<void> _markAllPresent() async {
    for (final AttendanceRosterEntry entry in _roster) {
      if (entry.status != AttendanceStatus.present) {
        await _mark(entry, AttendanceStatus.present);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme cs = theme.colorScheme;

    final int present = _roster
        .where((AttendanceRosterEntry e) => e.status == AttendanceStatus.present)
        .length;
    final int absent = _roster
        .where((AttendanceRosterEntry e) => e.status == AttendanceStatus.absent)
        .length;
    final int late = _roster
        .where((AttendanceRosterEntry e) => e.status == AttendanceStatus.late)
        .length;
    final int marked = _roster
        .where((AttendanceRosterEntry e) => e.status != null)
        .length;
    final int total = _roster.length;
    final int left = total - present - absent - late;

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
              if (_roster.isNotEmpty) ...<Widget>[
                _SummaryHeader(
                  present: present,
                  absent: absent,
                  late: late,
                  left: left,
                  total: total,
                  onMarkAllPresent: _markAllPresent,
                ),
                const SizedBox(height: 12),
              ],
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
                        separatorBuilder: (_, _) => const SizedBox(height: 8),
                        itemCount: _roster.length,
                      ),
              ),
            ],
          ),
        ),
      ),
      bottomNavigationBar: _roster.isEmpty
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: FilledButton.icon(
                  onPressed: marked == 0 ? null : _loadRoster,
                  icon: const Icon(Icons.check, size: 20),
                  label: Text('Submit · $marked of $total marked'),
                  style: FilledButton.styleFrom(
                    backgroundColor: cs.primary,
                    foregroundColor: cs.onPrimary,
                  ),
                ),
              ),
            ),
    );
  }
}

/// Counts header with a tri-colour distribution bar + "All present" action.
class _SummaryHeader extends StatelessWidget {
  const _SummaryHeader({
    required this.present,
    required this.absent,
    required this.late,
    required this.left,
    required this.total,
    required this.onMarkAllPresent,
  });

  final int present;
  final int absent;
  final int late;
  final int left;
  final int total;
  final VoidCallback onMarkAllPresent;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme cs = theme.colorScheme;
    final double denom = total == 0 ? 1 : total.toDouble();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: <Widget>[
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Wrap(
                    spacing: 14,
                    runSpacing: 4,
                    children: <Widget>[
                      _countLabel('$present present',
                          _AttendanceScreenState._presentColor),
                      _countLabel('$absent absent',
                          _AttendanceScreenState._absentColor),
                      _countLabel(
                          '$late late', _AttendanceScreenState._lateColor),
                      _countLabel('$left left', cs.onSurfaceVariant),
                    ],
                  ),
                  const SizedBox(height: 10),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(999),
                    child: SizedBox(
                      height: 8,
                      child: Row(
                        children: <Widget>[
                          Expanded(
                            flex: (present / denom * 1000).round(),
                            child: const ColoredBox(
                                color: _AttendanceScreenState._presentColor),
                          ),
                          Expanded(
                            flex: (absent / denom * 1000).round(),
                            child: const ColoredBox(
                                color: _AttendanceScreenState._absentColor),
                          ),
                          Expanded(
                            flex: (late / denom * 1000).round(),
                            child: const ColoredBox(
                                color: _AttendanceScreenState._lateColor),
                          ),
                          Expanded(
                            flex: (left / denom * 1000).round(),
                            child: ColoredBox(
                                color: cs.surfaceContainerHighest),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            OutlinedButton(
              onPressed: onMarkAllPresent,
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(0, 40),
                padding: const EdgeInsets.symmetric(horizontal: 14),
                textStyle: theme.textTheme.labelLarge,
              ),
              child: const Text('All present'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _countLabel(String text, Color color) {
    return Text(
      text,
      style: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w700,
        color: color,
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

  String _initials(String name) {
    final List<String> parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((String p) => p.isNotEmpty)
        .toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) {
      return parts.first.substring(0, 1).toUpperCase();
    }
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1))
        .toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme cs = theme.colorScheme;
    final bool hasComment = entry.comment != null && entry.comment!.isNotEmpty;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: <Widget>[
            CircleAvatar(
              radius: 20,
              backgroundColor: cs.primary.withValues(alpha: 0.12),
              child: Text(
                _initials(entry.studentName),
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: cs.primary,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    entry.studentName,
                    style: theme.textTheme.titleMedium,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: <Widget>[
                      Flexible(
                        child: Text(
                          entry.status == null
                              ? 'Not marked'
                              : entry.synced
                                  ? 'Synced'
                                  : 'Saved on device',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: cs.onSurfaceVariant,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (hasComment) ...<Widget>[
                        const SizedBox(width: 6),
                        Icon(
                          Icons.comment_outlined,
                          size: 13,
                          color: cs.onSurfaceVariant,
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            _SegmentedAttendance(
              status: entry.status,
              onMark: onMark,
            ),
            IconButton(
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.comment_outlined, size: 18),
              tooltip: 'Add comment',
              onPressed: onComment,
            ),
          ],
        ),
      ),
    );
  }
}

/// Compact P / A / L segmented control coloured by the v2.0 status palette.
class _SegmentedAttendance extends StatelessWidget {
  const _SegmentedAttendance({required this.status, required this.onMark});

  final AttendanceStatus? status;
  final void Function(AttendanceStatus status) onMark;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme cs = theme.colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: theme.dividerColor),
      ),
      padding: const EdgeInsets.all(2),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          _segment('P', AttendanceStatus.present,
              _AttendanceScreenState._presentColor),
          _segment(
              'A', AttendanceStatus.absent, _AttendanceScreenState._absentColor),
          _segment(
              'L', AttendanceStatus.late, _AttendanceScreenState._lateColor),
        ],
      ),
    );
  }

  Widget _segment(String label, AttendanceStatus value, Color color) {
    final bool selected = status == value;
    return GestureDetector(
      onTap: () => onMark(value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 120),
        width: 30,
        height: 30,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? color : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w800,
            color: selected ? Colors.white : color,
          ),
        ),
      ),
    );
  }
}
