import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/injector.dart';
import '../../../core/student/selected_student_store.dart';
import '../data/student_repository.dart';

/// Full-screen or sheet body that searches the student roster.
class StudentPickerBody extends StatefulWidget {
  const StudentPickerBody({super.key, required this.onSelected});

  final ValueChanged<CachedStudent> onSelected;

  @override
  State<StudentPickerBody> createState() => _StudentPickerBodyState();
}

class _StudentPickerBodyState extends State<StudentPickerBody> {
  final TextEditingController _searchCtrl = TextEditingController();
  late Future<List<CachedStudent>> _future = _search('');

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<List<CachedStudent>> _search(String query) {
    return getIt<StudentRepository>().searchStudents(query: query);
  }

  void _runSearch() {
    setState(() {
      _future = _search(_searchCtrl.text);
    });
  }

  Future<void> _choose(CachedStudent student) async {
    await getIt<SelectedStudentStore>().select(
      id: student.id,
      displayName: student.fullName,
    );
    if (!mounted) {
      return;
    }
    widget.onSelected(student);
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: Text(
            'Choose the student these records belong to.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: TextField(
            controller: _searchCtrl,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _runSearch(),
            decoration: InputDecoration(
              hintText: 'Search by name',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: IconButton(
                tooltip: 'Search',
                onPressed: _runSearch,
                icon: const Icon(Icons.refresh),
              ),
            ),
          ),
        ),
        Expanded(
          child: FutureBuilder<List<CachedStudent>>(
            future: _future,
            builder: (
              BuildContext context,
              AsyncSnapshot<List<CachedStudent>> snapshot,
            ) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                return _PickerMessage(
                  icon: Icons.error_outline,
                  title: 'Student list unavailable',
                  message:
                      'The roster could not be loaded. Check your connection and try again.',
                  onRetry: _runSearch,
                );
              }
              final List<CachedStudent> students =
                  snapshot.data ?? const <CachedStudent>[];
              if (students.isEmpty) {
                return const _PickerMessage(
                  icon: Icons.groups_outlined,
                  title: 'No students yet',
                  message:
                      'Open Students after you are online so the roster can download, then choose a student here.',
                );
              }
              return ListView.separated(
                itemCount: students.length,
                separatorBuilder: (BuildContext context, int index) =>
                    const Divider(height: 1),
                itemBuilder: (BuildContext context, int index) {
                  final CachedStudent student = students[index];
                  return ListTile(
                    minVerticalPadding: 16,
                    leading: const Icon(Icons.person_outline),
                    title: Text(student.fullName),
                    onTap: () {
                      unawaited(_choose(student));
                    },
                  );
                },
              );
            },
          ),
        ),
      ],
    );
  }
}

class _PickerMessage extends StatelessWidget {
  const _PickerMessage({
    required this.icon,
    required this.title,
    required this.message,
    this.onRetry,
  });

  final IconData icon;
  final String title;
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: 48, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(height: 12),
            Text(title, style: theme.textTheme.titleMedium, textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text(
              message,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
            if (onRetry != null) ...<Widget>[
              const SizedBox(height: 16),
              FilledButton(
                onPressed: onRetry,
                child: const Text('Try again'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Modal roster picker. Returns null when dismissed.
Future<CachedStudent?> showStudentPicker(BuildContext context) {
  return showModalBottomSheet<CachedStudent>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (BuildContext sheetContext) {
      return FractionallySizedBox(
        heightFactor: 0.85,
        child: StudentPickerBody(
          onSelected: (CachedStudent student) {
            Navigator.of(sheetContext).pop(student);
          },
        ),
      );
    },
  );
}

/// Shows a student picker until [studentId] is present, then builds [child].
///
/// Feature blocs must not be mounted — and must not request data — while the
/// id is blank.
class StudentRequiredGate extends StatefulWidget {
  const StudentRequiredGate({
    super.key,
    required this.studentId,
    required this.title,
    required this.locationFor,
    required this.child,
  });

  final String studentId;
  final String title;
  final String Function(String studentId) locationFor;
  final Widget child;

  @override
  State<StudentRequiredGate> createState() => _StudentRequiredGateState();
}

class _StudentRequiredGateState extends State<StudentRequiredGate> {
  @override
  void initState() {
    super.initState();
    _remember();
  }

  @override
  void didUpdateWidget(StudentRequiredGate oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.studentId != widget.studentId) {
      _remember();
    }
  }

  void _remember() {
    final String id = widget.studentId.trim();
    if (id.isEmpty) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      unawaited(getIt<SelectedStudentStore>().select(id: id));
    });
  }

  @override
  Widget build(BuildContext context) {
    if (widget.studentId.trim().isEmpty) {
      return Scaffold(
        appBar: AppBar(
          title: Semantics(header: true, child: Text(widget.title)),
        ),
        body: StudentPickerBody(
          onSelected: (CachedStudent student) {
            context.replace(widget.locationFor(student.id));
          },
        ),
      );
    }
    return widget.child;
  }
}
