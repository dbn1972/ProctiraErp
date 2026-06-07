import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:openemis_api_client/openemis_api_client.dart';

import '../../../core/di/injector.dart';
import '../../../core/storage/database.dart';
import '../../../core/sync/sync_engine.dart';
import '../../../core/tenant/tenant_provider.dart';
import '../data/student_repository.dart';

/// Static profile view backed by `students_cache`.
class StudentProfileScreen extends StatefulWidget {
  const StudentProfileScreen({super.key, required this.studentId});

  final String studentId;

  @override
  State<StudentProfileScreen> createState() => _StudentProfileScreenState();
}

class _StudentProfileScreenState extends State<StudentProfileScreen> {
  late Future<CachedStudent?> _future;
  late final StudentRepository _repository = StudentRepository(
    database: getIt<AppDatabase>(),
    tenantProvider: getIt<TenantProvider>(),
    syncEngine: getIt<SyncEngine>(),
    studentApi: getIt<StudentApi>(),
  );

  @override
  void initState() {
    super.initState();
    _future = _repository.getStudent(widget.studentId);
  }

  void _refresh() {
    setState(() {
      _future = _repository.getStudent(widget.studentId);
    });
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme cs = theme.colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Student profile')),
      body: SafeArea(
        child: FutureBuilder<CachedStudent?>(
          future: _future,
          builder: (BuildContext context, AsyncSnapshot<CachedStudent?> snap) {
            if (snap.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            final CachedStudent? student = snap.data;
            if (student == null) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Icon(Icons.person_off_outlined,
                          size: 48, color: cs.onSurfaceVariant),
                      const SizedBox(height: 16),
                      Text(
                        'Profile not in cache',
                        style: theme.textTheme.titleMedium,
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Student "${widget.studentId}" has not been cached yet. '
                        'Connect and refresh to load this record.',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodyMedium
                            ?.copyWith(color: cs.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
              );
            }
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
              children: <Widget>[
                _HeroCard(student: student),
                const SizedBox(height: 20),
                _SectionHeader(title: 'Personal details'),
                const SizedBox(height: 10),
                _DetailCard(
                  rows: <_DetailRow>[
                    _DetailRow('Student ID', student.id),
                    _DetailRow('National ID', student.nationalId ?? '—'),
                    _DetailRow('Date of birth', student.dateOfBirth ?? '—'),
                    _DetailRow('Gender', student.gender ?? '—'),
                    _DetailRow('Institution', student.institutionId ?? '—'),
                  ],
                ),
                const SizedBox(height: 20),
                _SectionHeader(
                  title: 'Documents',
                  trailing: '${student.documents.length}',
                ),
                const SizedBox(height: 10),
                _DocumentsCard(documents: student.documents),
                const SizedBox(height: 24),
                FilledButton.icon(
                  onPressed: () =>
                      context.push('/students/${student.id}/enrollments'),
                  icon: const Icon(Icons.history),
                  label: const Text('View enrollment history'),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: () async {
                    await context
                        .push('/students/${student.id}/documents/capture');
                    _refresh();
                  },
                  icon: const Icon(Icons.camera_alt_outlined),
                  label: const Text('Capture document'),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Header card: large avatar, name, and key meta chips drawn from real fields.
class _HeroCard extends StatelessWidget {
  const _HeroCard({required this.student});

  final CachedStudent student;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme cs = theme.colorScheme;

    final List<Widget> chips = <Widget>[];
    if (student.gender != null && student.gender!.isNotEmpty) {
      chips.add(_MetaChip(
        icon: Icons.wc_outlined,
        label: student.gender!,
        color: const Color(0xFF8B5CF6),
      ));
    }
    if (student.dateOfBirth != null && student.dateOfBirth!.isNotEmpty) {
      chips.add(_MetaChip(
        icon: Icons.cake_outlined,
        label: student.dateOfBirth!,
        color: const Color(0xFF0EA5E9),
      ));
    }
    if (student.institutionId != null && student.institutionId!.isNotEmpty) {
      chips.add(_MetaChip(
        icon: Icons.apartment_outlined,
        label: student.institutionId!,
        color: const Color(0xFF14B8A6),
      ));
    }

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 24),
        child: Column(
          children: <Widget>[
            CircleAvatar(
              radius: 40,
              backgroundColor: cs.primaryContainer,
              child: Text(
                student.fullName.isEmpty
                    ? '?'
                    : student.fullName[0].toUpperCase(),
                style: theme.textTheme.headlineSmall?.copyWith(
                  color: cs.onPrimaryContainer,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(height: 14),
            Text(
              student.fullName,
              textAlign: TextAlign.center,
              style: theme.textTheme.headlineSmall,
            ),
            if (student.nationalId != null &&
                student.nationalId!.isNotEmpty) ...<Widget>[
              const SizedBox(height: 4),
              Text(
                student.nationalId!,
                style: theme.textTheme.bodyMedium
                    ?.copyWith(color: cs.onSurfaceVariant),
              ),
            ],
            if (chips.isNotEmpty) ...<Widget>[
              const SizedBox(height: 16),
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 8,
                runSpacing: 8,
                children: chips,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A pill-shaped meta chip (icon + label) tinted with a status-palette color.
class _MetaChip extends StatelessWidget {
  const _MetaChip({
    required this.icon,
    required this.label,
    required this.color,
  });

  final IconData icon;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 6),
          Text(
            label,
            style: theme.textTheme.labelMedium
                ?.copyWith(color: color, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, this.trailing});

  final String title;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: Row(
        children: <Widget>[
          Text(title, style: theme.textTheme.titleMedium),
          if (trailing != null) ...<Widget>[
            const SizedBox(width: 8),
            Text(
              trailing!,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ],
      ),
    );
  }
}

class _DetailRow {
  const _DetailRow(this.label, this.value);
  final String label;
  final String value;
}

class _DetailCard extends StatelessWidget {
  const _DetailCard({required this.rows});

  final List<_DetailRow> rows;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme cs = theme.colorScheme;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Column(
          children: <Widget>[
            for (int i = 0; i < rows.length; i++) ...<Widget>[
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    SizedBox(
                      width: 130,
                      child: Text(
                        rows[i].label,
                        style: theme.textTheme.bodyMedium
                            ?.copyWith(color: cs.onSurfaceVariant),
                      ),
                    ),
                    Expanded(
                      child: Text(
                        rows[i].value,
                        style: theme.textTheme.bodyMedium
                            ?.copyWith(fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                ),
              ),
              if (i != rows.length - 1) const Divider(height: 1),
            ],
          ],
        ),
      ),
    );
  }
}

class _DocumentsCard extends StatelessWidget {
  const _DocumentsCard({required this.documents});

  final List<String> documents;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme cs = theme.colorScheme;
    if (documents.isEmpty) {
      return Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 22),
          child: Row(
            children: <Widget>[
              Icon(Icons.folder_off_outlined, color: cs.onSurfaceVariant),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'No documents captured yet.',
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(color: cs.onSurfaceVariant),
                ),
              ),
            ],
          ),
        ),
      );
    }
    const Color green = Color(0xFF10B981);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        child: Column(
          children: <Widget>[
            for (int i = 0; i < documents.length; i++) ...<Widget>[
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
                child: Row(
                  children: <Widget>[
                    Container(
                      width: 38,
                      height: 38,
                      decoration: BoxDecoration(
                        color: green.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(Icons.description_outlined,
                          size: 20, color: green),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        _fileName(documents[i]),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodyMedium
                            ?.copyWith(fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                ),
              ),
              if (i != documents.length - 1) const Divider(height: 1),
            ],
          ],
        ),
      ),
    );
  }

  static String _fileName(String path) {
    final int slash = path.lastIndexOf(RegExp(r'[\\/]'));
    return slash >= 0 ? path.substring(slash + 1) : path;
  }
}
