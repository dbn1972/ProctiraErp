import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/injector.dart';
import '../data/assessment_repository.dart';

/// Assessment hub — grading schemes plus navigation into student results.
class AssessmentHubScreen extends StatefulWidget {
  const AssessmentHubScreen({super.key});

  @override
  State<AssessmentHubScreen> createState() => _AssessmentHubScreenState();
}

class _AssessmentHubScreenState extends State<AssessmentHubScreen> {
  final TextEditingController _studentCtrl = TextEditingController();
  final TextEditingController _subjectCtrl = TextEditingController();
  final TextEditingController _periodCtrl = TextEditingController();

  late Future<List<GradingSchemeSummary>> _schemesFuture;

  @override
  void initState() {
    super.initState();
    _schemesFuture = getIt<AssessmentRepository>().listGradingSchemes();
  }

  @override
  void dispose() {
    _studentCtrl.dispose();
    _subjectCtrl.dispose();
    _periodCtrl.dispose();
    super.dispose();
  }

  void _openResults() {
    final String studentId = _studentCtrl.text.trim();
    if (studentId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a student ID to view results')),
      );
      return;
    }
    final Uri uri = Uri(
      path: '/assessments/results',
      queryParameters: <String, String>{
        'studentId': studentId,
        if (_subjectCtrl.text.trim().isNotEmpty)
          'subjectId': _subjectCtrl.text.trim(),
        if (_periodCtrl.text.trim().isNotEmpty)
          'periodId': _periodCtrl.text.trim(),
      },
    );
    context.push(uri.toString());
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Assessments')),
      body: RefreshIndicator(
        onRefresh: () async {
          setState(() {
            _schemesFuture =
                getIt<AssessmentRepository>().listGradingSchemes();
          });
          await _schemesFuture;
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: <Widget>[
            Text('Student results', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: <Widget>[
                    TextField(
                      controller: _studentCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Student ID',
                        prefixIcon: Icon(Icons.person_outline),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _subjectCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Subject ID (optional for /results/grades)',
                        prefixIcon: Icon(Icons.menu_book_outlined),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _periodCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Academic period ID (optional)',
                        prefixIcon: Icon(Icons.calendar_month_outlined),
                      ),
                    ),
                    const SizedBox(height: 16),
                    FilledButton.icon(
                      onPressed: _openResults,
                      icon: const Icon(Icons.assignment_outlined),
                      label: const Text('View results'),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),
            Text('Grading schemes', style: theme.textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              'Loaded from GET /grading-schemes',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 8),
            FutureBuilder<List<GradingSchemeSummary>>(
              future: _schemesFuture,
              builder: (BuildContext context,
                  AsyncSnapshot<List<GradingSchemeSummary>> snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Padding(
                    padding: EdgeInsets.all(24),
                    child: Center(child: CircularProgressIndicator()),
                  );
                }
                if (snapshot.hasError) {
                  return Card(
                    child: ListTile(
                      leading: Icon(Icons.error_outline,
                          color: theme.colorScheme.error),
                      title: const Text('Could not load grading schemes'),
                      subtitle: Text('${snapshot.error}'),
                      trailing: IconButton(
                        icon: const Icon(Icons.refresh),
                        onPressed: () {
                          setState(() {
                            _schemesFuture = getIt<AssessmentRepository>()
                                .listGradingSchemes();
                          });
                        },
                      ),
                    ),
                  );
                }
                final List<GradingSchemeSummary> schemes =
                    snapshot.data ?? const <GradingSchemeSummary>[];
                if (schemes.isEmpty) {
                  return const Card(
                    child: ListTile(
                      leading: Icon(Icons.inbox_outlined),
                      title: Text('No grading schemes yet'),
                      subtitle: Text(
                        'Schemes appear here once your school configures them.',
                      ),
                    ),
                  );
                }
                return Card(
                  child: Column(
                    children: <Widget>[
                      for (int i = 0; i < schemes.length; i++) ...<Widget>[
                        if (i > 0) const Divider(height: 1),
                        ListTile(
                          leading: const Icon(Icons.rule_folder_outlined),
                          title: Text(schemes[i].name),
                          subtitle: Text(
                            '${schemes[i].type} · '
                            '${schemes[i].minValue.toStringAsFixed(0)}–'
                            '${schemes[i].maxValue.toStringAsFixed(0)}'
                            '${schemes[i].thresholds.isEmpty ? '' : ' · ${schemes[i].thresholds.length} bands'}',
                          ),
                        ),
                      ],
                    ],
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}
