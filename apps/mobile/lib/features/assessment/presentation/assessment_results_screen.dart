import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

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
  const AssessmentResultsScreen({super.key, required this.studentId});

  final String studentId;

  @override
  Widget build(BuildContext context) {
    return BlocProvider<AssessmentBloc>(
      create: (BuildContext context) {
        final AssessmentBloc bloc = AssessmentBloc(
          repository: context.read<AssessmentRepository>(),
        );
        bloc.add(AssessmentResultsRequested(studentId: studentId));
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

class _ResultsList extends StatelessWidget {
  const _ResultsList({required this.results});

  final List<AssessmentResult> results;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: results.length,
      itemBuilder: (BuildContext context, int index) {
        final AssessmentResult result = results[index];
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
                        child: Text(
                          result.subjectName,
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      if (result.grade != null)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: _gradeColor(theme, result.grade!),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            result.grade!,
                            style: theme.textTheme.labelLarge?.copyWith(
                              color: theme.colorScheme.onPrimaryContainer,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    result.periodName,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 12),
                  // Score bar
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: LinearProgressIndicator(
                            value: result.maxScore != null && result.maxScore! > 0
                                ? result.score / result.maxScore!
                                : 0,
                            minHeight: 8,
                            backgroundColor:
                                theme.colorScheme.surfaceContainerHighest,
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Text(
                        '${result.score.toStringAsFixed(1)}'
                        '${result.maxScore != null ? " / ${result.maxScore!.toStringAsFixed(0)}" : ""}',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                  if (result.remarks != null && result.remarks!.isNotEmpty) ...<Widget>[
                    const SizedBox(height: 8),
                    Text(
                      result.remarks!,
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Color _gradeColor(ThemeData theme, String grade) {
    switch (grade.toUpperCase()) {
      case 'A+':
      case 'A':
        return theme.colorScheme.primaryContainer;
      case 'B+':
      case 'B':
        return theme.colorScheme.secondaryContainer;
      case 'C+':
      case 'C':
        return theme.colorScheme.tertiaryContainer;
      default:
        return theme.colorScheme.errorContainer;
    }
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
