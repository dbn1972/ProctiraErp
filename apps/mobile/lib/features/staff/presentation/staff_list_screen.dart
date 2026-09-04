import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/injector.dart';
import '../data/staff_repository.dart';

/// Searchable staff directory (`/staff`).
class StaffListScreen extends StatefulWidget {
  const StaffListScreen({super.key});

  @override
  State<StaffListScreen> createState() => _StaffListScreenState();
}

class _StaffListScreenState extends State<StaffListScreen> {
  final TextEditingController _search = TextEditingController();
  late Future<List<StaffMember>> _future;

  @override
  void initState() {
    super.initState();
    _future = getIt<StaffRepository>().listStaff();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _reload() {
    setState(() {
      _future = getIt<StaffRepository>().listStaff(search: _search.text.trim());
    });
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Staff')),
      body: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: TextField(
              controller: _search,
              onSubmitted: (_) => _reload(),
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: 'Search by name or employee ID',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: IconButton(
                  icon: const Icon(Icons.refresh),
                  onPressed: _reload,
                ),
              ),
            ),
          ),
          Expanded(
            child: FutureBuilder<List<StaffMember>>(
              future: _future,
              builder: (BuildContext context,
                  AsyncSnapshot<List<StaffMember>> snap) {
                if (snap.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }
                final List<StaffMember> items =
                    snap.data ?? const <StaffMember>[];
                if (items.isEmpty) {
                  return Center(
                    child: Text(
                      'No staff records found',
                      style: theme.textTheme.bodyLarge?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  );
                }
                return ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                  itemCount: items.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (BuildContext context, int index) {
                    final StaffMember staff = items[index];
                    final bool active =
                        staff.status.toUpperCase() == 'ACTIVE';
                    return Card(
                      child: ListTile(
                        leading: CircleAvatar(
                          child: Text(
                            staff.fullName.isNotEmpty
                                ? staff.fullName
                                    .trim()
                                    .split(RegExp(r'\s+'))
                                    .take(2)
                                    .map((String p) => p[0].toUpperCase())
                                    .join()
                                : '?',
                          ),
                        ),
                        title: Text(staff.fullName),
                        subtitle: Text(
                          <String>[
                            if (staff.identityNumber != null)
                              staff.identityNumber!,
                            staff.position,
                          ].join(' · '),
                        ),
                        trailing: Text(
                          active ? 'Active' : staff.status,
                          style: TextStyle(
                            color: active
                                ? const Color(0xFF10B981)
                                : theme.colorScheme.onSurfaceVariant,
                            fontWeight: FontWeight.w700,
                            fontSize: 12,
                          ),
                        ),
                        onTap: () => context.push('/staff/${staff.id}'),
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
