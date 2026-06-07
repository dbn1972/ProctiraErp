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
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    'Student "${widget.studentId}" not found in the cache.',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
              );
            }
            return SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    student.fullName,
                    style: theme.textTheme.headlineSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 16),
                  _Field(label: 'Student ID', value: student.id),
                  _Field(
                    label: 'National ID',
                    value: student.nationalId ?? '—',
                  ),
                  _Field(
                    label: 'Date of birth',
                    value: student.dateOfBirth ?? '—',
                  ),
                  _Field(label: 'Gender', value: student.gender ?? '—'),
                  _Field(
                    label: 'Institution',
                    value: student.institutionId ?? '—',
                  ),
                  const SizedBox(height: 24),
                  Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: <Widget>[
                      FilledButton.icon(
                        onPressed: () => context.push(
                          '/students/${student.id}/enrollments',
                        ),
                        icon: const Icon(Icons.history),
                        label: const Text('View enrollment history'),
                      ),
                      OutlinedButton.icon(
                        onPressed: () async {
                          await context.push(
                            '/students/${student.id}/documents/capture',
                          );
                          _refresh();
                        },
                        icon: const Icon(Icons.camera_alt_outlined),
                        label: const Text('Capture document'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Documents (${student.documents.length})',
                    style: theme.textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  if (student.documents.isEmpty)
                    Text(
                      'No documents captured yet.',
                      style: theme.textTheme.bodyMedium,
                    )
                  else
                    ...student.documents.map(
                      (String path) => ListTile(
                        leading: const Icon(Icons.insert_drive_file_outlined),
                        title: Text(path, maxLines: 2, overflow: TextOverflow.ellipsis),
                        dense: true,
                      ),
                    ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
            width: 140,
            child: Text(
              label,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: theme.textTheme.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }
}
