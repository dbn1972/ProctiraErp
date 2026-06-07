import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/l10n/app_localizations.dart';
import '../bloc/examination_bloc.dart';
import '../data/examination_repository.dart';

/// Screen displaying published examination results.
class ExaminationResultsScreen extends StatelessWidget {
  const ExaminationResultsScreen({super.key, required this.studentId});

  final String studentId;

  @override
  Widget build(BuildContext context) {
    return BlocProvider<ExaminationBloc>(
      create: (BuildContext context) {
        final ExaminationBloc bloc = ExaminationBloc(
          repository: context.read<ExaminationRepository>(),
        );
        bloc.add(ExaminationResultsRequested(studentId: studentId));
        return bloc;
      },
      child: const _ExaminationResultsView(),
    );
  }
}

class _ExaminationResultsView extends StatelessWidget {
  const _ExaminationResultsView();

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Semantics(
          header: true,
          child: Text('${l10n.examinations} ${l10n.results}'),
        ),
      ),
      body: BlocBuilder<ExaminationBloc, ExaminationState>(
        builder: (BuildContext context, ExaminationState state) {
          switch (state.status) {
            case ExaminationStatus.initial:
            case ExaminationStatus.loading:
              return const _ShimmerLoading();
            case ExaminationStatus.error:
              return _ErrorView(
                message: state.errorMessage ?? l10n.error,
                onRetry: () {
                  context.read<ExaminationBloc>().add(
                        ExaminationResultsRequested(
                            studentId: state.studentId),
                      );
                },
              );
            case ExaminationStatus.loaded:
              if (state.results.isEmpty) {
                return const _EmptyView();
              }
              return _ResultsList(results: state.results);
          }
        },
      ),
    );
  }
}

// ProctiraERP Design System v2.0 status/grade palette.
const Color _green = Color(0xFF10B981);
const Color _amber = Color(0xFFF59E0B);
const Color _red = Color(0xFFEF4444);
const Color _sky = Color(0xFF0EA5E9);
const Color _violet = Color(0xFF8B5CF6);

/// Color for a score percentage by threshold: green >=75, amber >=40, red below.
Color _percentColor(double percent) {
  if (percent >= 75) {
    return _green;
  }
  if (percent >= 40) {
    return _amber;
  }
  return _red;
}

/// Color for a letter/band grade chip.
Color _gradeColor(String grade) {
  switch (grade.toUpperCase()) {
    case 'A+':
    case 'A':
    case 'A1':
    case 'A2':
      return _green;
    case 'B+':
    case 'B':
    case 'B1':
    case 'B2':
      return _sky;
    case 'C+':
    case 'C':
    case 'C1':
    case 'C2':
      return _amber;
    case 'D':
    case 'E':
    case 'F':
      return _red;
    default:
      return _violet;
  }
}

/// Pill-style chip with a colored tint background and a bold colored label.
class _StatChip extends StatelessWidget {
  const _StatChip({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _ResultsList extends StatelessWidget {
  const _ResultsList({required this.results});

  final List<ExaminationResult> results;

  @override
  Widget build(BuildContext context) {
    // Group results by examination name.
    final Map<String, List<ExaminationResult>> grouped =
        <String, List<ExaminationResult>>{};
    for (final ExaminationResult result in results) {
      grouped.putIfAbsent(result.examinationName, () => <ExaminationResult>[]);
      grouped[result.examinationName]!.add(result);
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: grouped.length,
      itemBuilder: (BuildContext context, int index) {
        final String examName = grouped.keys.elementAt(index);
        final List<ExaminationResult> examResults = grouped[examName]!;
        return _ExamResultCard(examName: examName, results: examResults);
      },
    );
  }
}

class _ExamResultCard extends StatelessWidget {
  const _ExamResultCard({required this.examName, required this.results});

  final String examName;
  final List<ExaminationResult> results;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    // Weighted average across rows that carry a real max score.
    double totalScore = 0;
    double totalMax = 0;
    for (final ExaminationResult r in results) {
      if (r.maxScore != null && r.maxScore! > 0) {
        totalScore += r.score;
        totalMax += r.maxScore!;
      }
    }
    final bool hasAverage = totalMax > 0;
    final double averagePercent = hasAverage ? (totalScore / totalMax) * 100 : 0;

    return Semantics(
      label: 'Examination: $examName, ${results.length} subjects',
      child: Card(
        margin: const EdgeInsets.only(bottom: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: Text(examName, style: theme.textTheme.titleMedium),
                  ),
                  const SizedBox(width: 12),
                  if (hasAverage)
                    _StatChip(
                      label: '${averagePercent.toStringAsFixed(1)}% avg',
                      color: _percentColor(averagePercent),
                    ),
                ],
              ),
            ),
            const Divider(height: 1),
            ...List<Widget>.generate(results.length, (int i) {
              return _SubjectRow(
                result: results[i],
                showDivider: i < results.length - 1,
              );
            }),
          ],
        ),
      ),
    );
  }
}

class _SubjectRow extends StatelessWidget {
  const _SubjectRow({required this.result, required this.showDivider});

  final ExaminationResult result;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final bool hasMax = result.maxScore != null && result.maxScore! > 0;
    final double percent =
        hasMax ? (result.score / result.maxScore!) * 100 : 0;

    return Column(
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      result.subjectName,
                      style: theme.textTheme.bodyLarge?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Text(
                    '${result.score.toStringAsFixed(1)}'
                    '${result.maxScore != null ? " / ${result.maxScore!.toStringAsFixed(0)}" : ""}',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      fontFeatures: const <FontFeature>[
                        FontFeature.tabularFigures(),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  if (result.grade != null)
                    _StatChip(
                      label: result.grade!,
                      color: _gradeColor(result.grade!),
                    ),
                ],
              ),
              if (hasMax) ...<Widget>[
                const SizedBox(height: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(999),
                  child: LinearProgressIndicator(
                    value: (percent / 100).clamp(0.0, 1.0),
                    minHeight: 6,
                    backgroundColor: theme.colorScheme.surfaceContainerHighest,
                    valueColor:
                        AlwaysStoppedAnimation<Color>(_percentColor(percent)),
                  ),
                ),
              ],
              if (result.rank != null ||
                  (result.remarks != null &&
                      result.remarks!.isNotEmpty)) ...<Widget>[
                const SizedBox(height: 8),
                Row(
                  children: <Widget>[
                    if (result.rank != null) ...<Widget>[
                      Icon(
                        Icons.emoji_events_outlined,
                        size: 14,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'Rank #${result.rank}',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                      if (result.remarks != null &&
                          result.remarks!.isNotEmpty)
                        const SizedBox(width: 12),
                    ],
                    if (result.remarks != null && result.remarks!.isNotEmpty)
                      Expanded(
                        child: Text(
                          result.remarks!,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                            fontStyle: FontStyle.italic,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                ),
              ],
            ],
          ),
        ),
        if (showDivider) const Divider(height: 1, indent: 16, endIndent: 16),
      ],
    );
  }
}

class _ShimmerLoading extends StatelessWidget {
  const _ShimmerLoading();

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Semantics(
      label: 'Loading examination results',
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: 3,
        itemBuilder: (BuildContext context, int index) {
          return Card(
            margin: const EdgeInsets.only(bottom: 16),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Container(
                    height: 18,
                    width: 200,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(height: 16),
                  ...List<Widget>.generate(4, (int i) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Container(
                      height: 14,
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                  )),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.error_outline, size: 48, color: theme.colorScheme.error),
            const SizedBox(height: 16),
            Text(message, style: theme.textTheme.bodyLarge, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            Semantics(
              button: true,
              label: 'Retry loading results',
              child: FilledButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: Text(AppLocalizations.of(context).retry),
                style: FilledButton.styleFrom(minimumSize: const Size(48, 48)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyView extends StatelessWidget {
  const _EmptyView();

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(
              Icons.grading_outlined,
              size: 64,
              color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
            ),
            const SizedBox(height: 16),
            Text(
              'No results published yet',
              style: theme.textTheme.bodyLarge?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'Results will appear here once your institution publishes them.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.7),
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
