import 'package:flutter/material.dart';

import '../../../core/di/injector.dart';
import '../../../core/storage/database.dart';
import '../../../core/tenant/tenant_provider.dart';
import '../data/enrollment_repository.dart';

/// Lists every enrollment row known locally for the given student, grouped
/// by academic period. Intended to be rendered without network access.
class EnrollmentHistoryScreen extends StatefulWidget {
  const EnrollmentHistoryScreen({super.key, required this.studentId});

  final String studentId;

  @override
  State<EnrollmentHistoryScreen> createState() => _EnrollmentHistoryScreenState();
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
              return Center(child: Text('Error: ${snapshot.error}'));
            }
            final Map<String, List<EnrollmentEntry>> grouped =
                snapshot.data ?? const <String, List<EnrollmentEntry>>{};
            if (grouped.isEmpty) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    'No enrollment records cached for this student. '
                    'Connect to the network and refresh to populate the history.',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
              );
            }
            return ListView(
              padding: const EdgeInsets.all(12),
              children: grouped.entries.map((MapEntry<String, List<EnrollmentEntry>> e) {
                return Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          e.key,
                          style: theme.textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 8),
                        ...e.value.map(_buildEntry),
                      ],
                    ),
                  ),
                );
              }).toList(growable: false),
            );
          },
        ),
      ),
    );
  }

  Widget _buildEntry(EnrollmentEntry entry) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Icon(Icons.school_outlined, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  entry.institutionName ?? entry.institutionId ?? 'Unknown institution',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                Text(
                  '${entry.status ?? '—'} • '
                  '${entry.enrolledAt ?? '?'} → ${entry.exitedAt ?? 'present'}',
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
