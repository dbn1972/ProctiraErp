import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/di/injector.dart';
import '../../../core/l10n/app_localizations.dart';
import '../bloc/assessment_bloc.dart';
import '../data/assessment_repository.dart';

/// Screen displaying assessment results per subject and period.
///
/// Features:
/// - Filter by subject and period via dropdown chips.
/// - Shimmer loading state.
/// - Error state with retry.
/// - Empty state with helpful message.
/// - Accessible with semantic labels and 48px touch targets.
class AssessmentResultsScreen extends StatelessWidget {
  const AssessmentResultsScreen({
    super.key,
    required this.studentId,
    this.subjectId,
    this.periodId,
  });

  final String studentId;
  final String? subjectId;
  final String? periodId;

  @override
  Widget build(BuildContext context) {
    return BlocProvider<AssessmentBloc>(
      create: (BuildContext context) {
        final AssessmentBloc bloc = AssessmentBloc(
          repository: getIt<AssessmentRepository>(),
        );
        bloc.add(AssessmentResultsRequested(
          studentId: studentId,
          subjectFilter: subjectId,
          periodFilter: periodId,
        ));
        return bloc;
      },
      child: const _AssessmentResultsView(),
    );
  }
}

class _AssessmentResultsView extends StatelessWidget {
  const _AssessmentResultsView();

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Semantics(
          header: true,
          child: Text(l10n.assessments),
        ),
      ),
      body: BlocBuilder<AssessmentBloc, AssessmentState>(
        builder: (BuildContext context, AssessmentState state) {
          return Column(
            children: <Widget>[
              // Filter bar
              if (state.status == AssessmentStatus.loaded)
                _FilterBar(state: state),
              // Content
              Expanded(child: _buildContent(context, state, theme, l10n)),
            ],
          );
        },
      ),
    );
  }

  Widget _buildContent(
    BuildContext context,
    AssessmentState state,
    ThemeData theme,
    AppLocalizations l10n,
  ) {
    switch (state.status) {
      case AssessmentStatus.initial:
      case AssessmentStatus.loading:
        return const _ShimmerLoading();
      case AssessmentStatus.error:
        return _ErrorView(
          message: state.errorMessage ?? l10n.error,
          onRetry: () {
            context.read<AssessmentBloc>().add(
                  AssessmentResultsRequested(studentId: state.studentId),
                );
          },
        );
      case AssessmentStatus.loaded:
        if (state.results.isEmpty) {
          return _EmptyView(message: l10n.noData);
        }
        return _ResultsList(results: state.results);
    }
  }
}

class _FilterBar extends StatelessWidget {
  const _FilterBar({required this.state});

  final AssessmentState state;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: <Widget>[
          if (state.subjects.isNotEmpty)
            _FilterChip(
              label: 'Subject',
              value: state.selectedSubject,
              options: state.subjects,
              onSelected: (String? value) {
                context.read<AssessmentBloc>().add(
                      AssessmentFilterChanged(
                        subject: value,
                        period: state.selectedPeriod,
                      ),
                    );
              },
            ),
          if (state.periods.isNotEmpty)
            _FilterChip(
              label: 'Period',
              value: state.selectedPeriod,
              options: state.periods,
              onSelected: (String? value) {
                context.read<AssessmentBloc>().add(
                      AssessmentFilterChanged(
                        subject: state.selectedSubject,
                        period: value,
                      ),
                    );
              },
            ),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.value,
    required this.options,
    required this.onSelected,
  });

  final String label;
  final String? value;
  final List<String> options;
  final ValueChanged<String?> onSelected;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '$label filter',
      child: PopupMenuButton<String?>(
        initialValue: value,
        onSelected: onSelected,
        constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
        itemBuilder: (BuildContext context) => <PopupMenuEntry<String?>>[
          PopupMenuItem<String?>(
            value: null,
            height: 48,
            child: Text('All ${label}s'),
          ),
          ...options.map((String option) => PopupMenuItem<String?>(
                value: option,
                height: 48,
                child: Text(option),
              )),
        ],
        child: Chip(
          label: Text(value ?? 'All ${label}s'),
          avatar: const Icon(Icons.filter_list, size: 18),
          deleteIcon: value != null ? const Icon(Icons.close, size: 18) : null,
          onDeleted: value != null ? () => onSelected(null) : null,
        ),
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
    case 'F':
    case 'E':
      return _red;
    default:
      return _violet;
  }
}

/// Pill-style chip with a colored background tint and a bold colored label.
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

  final List<AssessmentResult> results;

  @override
  Widget build(BuildContext context) {
    // Weighted average across results that carry a real max score.
    double totalScore = 0;
    double totalMax = 0;
    for (final AssessmentResult r in results) {
      if (r.maxScore != null && r.maxScore! > 0) {
        totalScore += r.score;
        totalMax += r.maxScore!;
      }
    }
    final bool hasAverage = totalMax > 0;
    final double averagePercent = hasAverage ? (totalScore / totalMax) * 100 : 0;

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: results.length + (hasAverage ? 1 : 0),
      itemBuilder: (BuildContext context, int index) {
        if (hasAverage && index == 0) {
          return _AverageHeader(
            percent: averagePercent,
            totalScore: totalScore,
            totalMax: totalMax,
          );
        }
        final AssessmentResult result =
            results[index - (hasAverage ? 1 : 0)];
        return _ResultCard(result: result);
      },
    );
  }
}

class _AverageHeader extends StatelessWidget {
  const _AverageHeader({
    required this.percent,
    required this.totalScore,
    required this.totalMax,
  });

  final double percent;
  final double totalScore;
  final double totalMax;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final Color color = _percentColor(percent);

    return Semantics(
      label: 'Weighted average ${percent.toStringAsFixed(1)} percent',
      child: Card(
        margin: const EdgeInsets.only(bottom: 16),
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        'Weighted average',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${totalScore.toStringAsFixed(0)} / ${totalMax.toStringAsFixed(0)}',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                  Text(
                    '${percent.toStringAsFixed(1)}%',
                    style: theme.textTheme.headlineSmall?.copyWith(color: color),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              ClipRRect(
                borderRadius: BorderRadius.circular(999),
                child: LinearProgressIndicator(
                  value: (percent / 100).clamp(0.0, 1.0),
                  minHeight: 10,
                  backgroundColor: theme.colorScheme.surfaceContainerHighest,
                  valueColor: AlwaysStoppedAnimation<Color>(color),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ResultCard extends StatelessWidget {
  const _ResultCard({required this.result});

  final AssessmentResult result;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final bool hasPercent =
        result.maxScore != null && result.maxScore! > 0;
    final double percent = hasPercent ? result.percentage : 0;

    return Semantics(
      label:
          '${result.subjectName}, ${result.periodName}, score ${result.score} '
          'out of ${result.maxScore ?? "unknown"}, grade ${result.grade ?? "not graded"}',
      child: Card(
        margin: const EdgeInsets.only(bottom: 12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          result.subjectName,
                          style: theme.textTheme.titleMedium,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          result.periodName,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (result.grade != null)
                    _StatChip(
                      label: result.grade!,
                      color: _gradeColor(result.grade!),
                    ),
                ],
              ),
              const SizedBox(height: 14),
              Row(
                children: <Widget>[
                  if (hasPercent)
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(999),
                        child: LinearProgressIndicator(
                          value: (percent / 100).clamp(0.0, 1.0),
                          minHeight: 8,
                          backgroundColor:
                              theme.colorScheme.surfaceContainerHighest,
                          valueColor: AlwaysStoppedAnimation<Color>(
                            _percentColor(percent),
                          ),
                        ),
                      ),
                    )
                  else
                    const Spacer(),
                  const SizedBox(width: 12),
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
                ],
              ),
              if (result.remarks != null && result.remarks!.isNotEmpty) ...<Widget>[
                const SizedBox(height: 10),
                Text(
                  result.remarks!,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _ShimmerLoading extends StatelessWidget {
  const _ShimmerLoading();

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Semantics(
      label: 'Loading assessment results',
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: 5,
        itemBuilder: (BuildContext context, int index) {
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Container(
                    height: 16,
                    width: 150,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    height: 12,
                    width: 100,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Container(
                    height: 8,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
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
            Icon(
              Icons.error_outline,
              size: 48,
              color: theme.colorScheme.error,
            ),
            const SizedBox(height: 16),
            Text(
              message,
              style: theme.textTheme.bodyLarge,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            Semantics(
              button: true,
              label: 'Retry loading assessment results',
              child: FilledButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: Text(AppLocalizations.of(context).retry),
                style: FilledButton.styleFrom(
                  minimumSize: const Size(48, 48),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyView extends StatelessWidget {
  const _EmptyView({required this.message});

  final String message;

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
              Icons.assignment_outlined,
              size: 64,
              color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
            ),
            const SizedBox(height: 16),
            Text(
              message,
              style: theme.textTheme.bodyLarge?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'Assessment results will appear here once published by your institution.',
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
