import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:openemis_api_client/openemis_api_client.dart';

import '../../../core/di/injector.dart';
import '../../../core/storage/database.dart';
import '../../../core/sync/sync_engine.dart';
import '../../../core/tenant/tenant_provider.dart';
import '../data/student_repository.dart';

/// Searchable list of students backed by [StudentRepository] (cache-first).
class StudentsScreen extends StatefulWidget {
  const StudentsScreen({super.key});

  @override
  State<StudentsScreen> createState() => _StudentsScreenState();
}

class _StudentsScreenState extends State<StudentsScreen> {
  final TextEditingController _searchCtrl = TextEditingController();
  late final StudentRepository _repository = StudentRepository(
    database: getIt<AppDatabase>(),
    tenantProvider: getIt<TenantProvider>(),
    syncEngine: getIt<SyncEngine>(),
    studentApi: getIt<StudentApi>(),
  );

  late Future<List<CachedStudent>> _future;

  @override
  void initState() {
    super.initState();
    _future = _repository.searchStudents();
  }

  void _runSearch() {
    setState(() {
      _future = _repository.searchStudents(query: _searchCtrl.text);
    });
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Students')),
      body: SafeArea(
        child: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.all(16),
              child: TextField(
                controller: _searchCtrl,
                onSubmitted: (_) => _runSearch(),
                decoration: InputDecoration(
                  hintText: 'Search by name or national id',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: IconButton(
                    icon: const Icon(Icons.refresh),
                    onPressed: _runSearch,
                  ),
                ),
              ),
            ),
            Expanded(
              child: FutureBuilder<List<CachedStudent>>(
                future: _future,
                builder: (BuildContext context,
                    AsyncSnapshot<List<CachedStudent>> snapshot) {
                  if (snapshot.connectionState != ConnectionState.done) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  if (snapshot.hasError) {
                    return Center(
                      child: Text(
                        'Error: ${snapshot.error}',
                        style: theme.textTheme.bodyMedium,
                      ),
                    );
                  }
                  final List<CachedStudent> students = snapshot.data ?? const <CachedStudent>[];
                  if (students.isEmpty) {
                    return Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          'No cached students yet. Connect to the network to populate the cache.',
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodyMedium,
                        ),
                      ),
                    );
                  }
                  return ListView.separated(
                    itemBuilder: (BuildContext context, int index) {
                      final CachedStudent s = students[index];
                      return ListTile(
                        leading: CircleAvatar(
                          backgroundColor: theme.colorScheme.primaryContainer,
                          child: Text(
                            s.fullName.isEmpty
                                ? '?'
                                : s.fullName[0].toUpperCase(),
                          ),
                        ),
                        title: Text(s.fullName),
                        subtitle: Text(s.nationalId == null
                            ? (s.institutionId ?? '—')
                            : '${s.nationalId} • ${s.institutionId ?? ''}'),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => context.push('/students/${s.id}'),
                      );
                    },
                    separatorBuilder: (_, _) => const Divider(height: 0),
                    itemCount: students.length,
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
