import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/injector.dart';
import '../data/examination_repository.dart';

/// Examination detail from `GET /api/v1/examinations/:id`.
class ExaminationDetailScreen extends StatefulWidget {
  const ExaminationDetailScreen({
    super.key,
    required this.examinationId,
    this.studentId = '',
  });

  final String examinationId;
  final String studentId;

  @override
  State<ExaminationDetailScreen> createState() =>
      _ExaminationDetailScreenState();
}

class _ExaminationDetailScreenState extends State<ExaminationDetailScreen> {
  late Future<_DetailBundle> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_DetailBundle> _load() async {
    final ExaminationRepository repo = getIt<ExaminationRepository>();
    final ExaminationDetail detail =
        await repo.getExamination(widget.examinationId);
    final ExaminationPublicationSummary? publication =
        await repo.getPublicationSummary(widget.examinationId);
    List<ExaminationCandidate> candidates = const <ExaminationCandidate>[];
    try {
      candidates = await repo.listCandidates(widget.examinationId);
    } catch (_) {
      candidates = const <ExaminationCandidate>[];
    }
    return _DetailBundle(
      detail: detail,
      publication: publication,
      candidates: candidates,
    );
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Examination')),
      body: FutureBuilder<_DetailBundle>(
        future: _future,
        builder: (BuildContext context, AsyncSnapshot<_DetailBundle> snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    const Icon(Icons.error_outline, size: 48),
                    const SizedBox(height: 12),
                    Text(
                      'Could not load examination.',
                      style: theme.textTheme.titleMedium,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${snapshot.error}',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodySmall,
                    ),
                    const SizedBox(height: 16),
                    FilledButton.icon(
                      onPressed: () {
                        setState(() => _future = _load());
                      },
                      icon: const Icon(Icons.refresh),
                      label: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            );
          }

          final ExaminationDetail exam = snapshot.data!.detail;
          final ExaminationPublicationSummary? pub =
              snapshot.data!.publication;
          final List<ExaminationCandidate> candidates =
              snapshot.data!.candidates;

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            children: <Widget>[
              Text(exam.name, style: theme.textTheme.headlineSmall),
              if (exam.code.isNotEmpty) ...<Widget>[
                const SizedBox(height: 4),
                Text(
                  exam.code,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontFamily: 'monospace',
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
              const SizedBox(height: 8),
              Text(
                '${exam.status} · ${exam.startDate} → ${exam.endDate}',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              if (exam.description != null &&
                  exam.description!.isNotEmpty) ...<Widget>[
                const SizedBox(height: 12),
                Text(exam.description!),
              ],
              const SizedBox(height: 16),
              _Section(
                title: 'Subjects (${exam.subjects.length})',
                emptyLabel: 'No subjects on this examination',
                children: <Widget>[
                  for (final Map<String, dynamic> s in exam.subjects)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text((s['name'] as String?) ?? 'Subject'),
                      subtitle: Text(
                        '${s['code'] ?? ''} · max ${s['maxScore'] ?? '—'}',
                      ),
                    ),
                ],
              ),
              _Section(
                title: 'Centers (${exam.centers.length})',
                emptyLabel: 'No centers configured',
                children: <Widget>[
                  for (final Map<String, dynamic> c in exam.centers)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text((c['name'] as String?) ?? 'Center'),
                      subtitle: Text(
                        '${c['code'] ?? ''} · capacity ${c['capacity'] ?? '—'}',
                      ),
                    ),
                ],
              ),
              _Section(
                title: 'Sessions (${exam.sessions.length})',
                emptyLabel: 'No sessions scheduled',
                children: <Widget>[
                  for (final Map<String, dynamic> s in exam.sessions)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text((s['date'] as String?) ?? 'Session'),
                      subtitle: Text(
                        '${s['startTime'] ?? ''} – ${s['endTime'] ?? ''}',
                      ),
                    ),
                ],
              ),
              _Section(
                title: 'Candidates (${candidates.length})',
                emptyLabel: 'No candidates registered yet',
                children: <Widget>[
                  for (final ExaminationCandidate c in candidates)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(c.studentId),
                      subtitle: Text(
                        '${c.status}'
                        '${c.registeredAt != null ? ' · ${c.registeredAt}' : ''}'
                        ' · ${c.subjectIds.length} subject(s)',
                      ),
                    ),
                ],
              ),
              if (pub != null) ...<Widget>[
                const SizedBox(height: 8),
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.insights_outlined),
                    title: const Text('Published results'),
                    subtitle: Text(
                      '${pub.processedCount}/${pub.totalCandidates} processed'
                      '${pub.incompleteCount > 0 ? ' · ${pub.incompleteCount} incomplete' : ''}'
                      '${pub.publishedAt != null ? '\n${pub.publishedAt}' : ''}',
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: () {
                  final String q = widget.studentId.isEmpty
                      ? ''
                      : '?studentId=${widget.studentId}';
                  context.push(
                    '/examinations/results$q',
                    extra: exam.id,
                  );
                },
                icon: const Icon(Icons.assessment_outlined),
                label: const Text('View results'),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _DetailBundle {
  const _DetailBundle({
    required this.detail,
    this.publication,
    this.candidates = const <ExaminationCandidate>[],
  });
  final ExaminationDetail detail;
  final ExaminationPublicationSummary? publication;
  final List<ExaminationCandidate> candidates;
}

class _Section extends StatelessWidget {
  const _Section({
    required this.title,
    required this.children,
    required this.emptyLabel,
  });

  final String title;
  final List<Widget> children;
  final String emptyLabel;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(title, style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          if (children.isEmpty)
            Text(
              emptyLabel,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            )
          else
            Card(
              margin: EdgeInsets.zero,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: Column(children: children),
              ),
            ),
        ],
      ),
    );
  }
}
