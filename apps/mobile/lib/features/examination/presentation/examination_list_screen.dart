import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/app_localizations.dart';
import '../bloc/examination_bloc.dart';
import '../data/examination_repository.dart';

/// Screen showing upcoming examinations with countdown timers.
class ExaminationListScreen extends StatelessWidget {
  const ExaminationListScreen({super.key, required this.studentId});

  final String studentId;

  @override
  Widget build(BuildContext context) {
    return BlocProvider<ExaminationBloc>(
      create: (BuildContext context) {
        final ExaminationBloc bloc = ExaminationBloc(
          repository: context.read<ExaminationRepository>(),
        );
        bloc.add(ExaminationListRequested(studentId: studentId));
        return bloc;
      },
      child: const _ExaminationListView(),
    );
  }
}

class _ExaminationListView extends StatelessWidget {
  const _ExaminationListView();

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Semantics(
          header: true,
          child: Text(l10n.examinations),
        ),
        actions: <Widget>[
          Semantics(
            button: true,
            label: 'View examination results',
            child: IconButton(
              icon: const Icon(Icons.assessment_outlined),
              tooltip: 'Results',
              onPressed: () {
                final ExaminationState state =
                    context.read<ExaminationBloc>().state;
                context.push('/examinations/results?studentId=${state.studentId}');
              },
            ),
          ),
        ],
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
                        ExaminationListRequested(studentId: state.studentId),
                      );
                },
              );
            case ExaminationStatus.loaded:
              if (state.examinations.isEmpty) {
                return const _EmptyView();
              }
              return _ExamList(examinations: state.examinations);
          }
        },
      ),
    );
  }
}

class _ExamList extends StatelessWidget {
  const _ExamList({required this.examinations});

  final List<Examination> examinations;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: examinations.length,
      itemBuilder: (BuildContext context, int index) {
        final Examination exam = examinations[index];
        final int daysLeft = exam.daysUntil;

        return Semantics(
          label: '${exam.name}, ${exam.subjectName}, '
              '${daysLeft >= 0 ? "$daysLeft days remaining" : "completed"}',
          child: Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: () {
                // Show exam details in a bottom sheet.
                _showExamDetails(context, exam);
              },
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: <Widget>[
                    // Countdown badge
                    _CountdownBadge(daysLeft: daysLeft, theme: theme),
                    const SizedBox(width: 16),
                    // Exam info
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            exam.name,
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            exam.subjectName,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Row(
                            children: <Widget>[
                              Icon(
                                Icons.schedule_outlined,
                                size: 14,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                              const SizedBox(width: 4),
                              Text(
                                '${exam.startTime} – ${exam.endTime}',
                                style: theme.textTheme.bodySmall,
                              ),
                            ],
                          ),
                          if (exam.venue != null) ...<Widget>[
                            const SizedBox(height: 2),
                            Row(
                              children: <Widget>[
                                Icon(
                                  Icons.location_on_outlined,
                                  size: 14,
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                                const SizedBox(width: 4),
                                Expanded(
                                  child: Text(
                                    exam.venue!,
                                    style: theme.textTheme.bodySmall,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                    Icon(
                      Icons.chevron_right,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  void _showExamDetails(BuildContext context, Examination exam) {
    final ThemeData theme = Theme.of(context);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (BuildContext ctx) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.onSurfaceVariant
                          .withValues(alpha: 0.3),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text(exam.name, style: theme.textTheme.headlineSmall),
                const SizedBox(height: 8),
                Text(exam.subjectName, style: theme.textTheme.titleMedium),
                const SizedBox(height: 16),
                _DetailRow(
                  icon: Icons.calendar_today_outlined,
                  label: 'Date',
                  value: exam.examDate,
                ),
                _DetailRow(
                  icon: Icons.schedule_outlined,
                  label: 'Time',
                  value: '${exam.startTime} – ${exam.endTime}',
                ),
                if (exam.venue != null)
                  _DetailRow(
                    icon: Icons.location_on_outlined,
                    label: 'Venue',
                    value: exam.venue!,
                  ),
                if (exam.instructions != null &&
                    exam.instructions!.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 16),
                  Text('Instructions',
                      style: theme.textTheme.titleSmall),
                  const SizedBox(height: 8),
                  Text(exam.instructions!,
                      style: theme.textTheme.bodyMedium),
                ],
                const SizedBox(height: 24),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: <Widget>[
          Icon(icon, size: 18, color: theme.colorScheme.primary),
          const SizedBox(width: 8),
          Text('$label: ', style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: FontWeight.w600,
          )),
          Expanded(child: Text(value, style: theme.textTheme.bodyMedium)),
        ],
      ),
    );
  }
}

class _CountdownBadge extends StatelessWidget {
  const _CountdownBadge({required this.daysLeft, required this.theme});

  final int daysLeft;
  final ThemeData theme;

  @override
  Widget build(BuildContext context) {
    final Color bgColor;
    final Color textColor;

    if (daysLeft <= 3 && daysLeft >= 0) {
      bgColor = theme.colorScheme.errorContainer;
      textColor = theme.colorScheme.onErrorContainer;
    } else if (daysLeft <= 7 && daysLeft >= 0) {
      bgColor = theme.colorScheme.tertiaryContainer;
      textColor = theme.colorScheme.onTertiaryContainer;
    } else {
      bgColor = theme.colorScheme.primaryContainer;
      textColor = theme.colorScheme.onPrimaryContainer;
    }

    return Container(
      width: 56,
      height: 56,
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          Text(
            daysLeft >= 0 ? '$daysLeft' : '—',
            style: theme.textTheme.titleLarge?.copyWith(
              color: textColor,
              fontWeight: FontWeight.w700,
            ),
          ),
          Text(
            daysLeft >= 0 ? 'days' : 'done',
            style: theme.textTheme.labelSmall?.copyWith(color: textColor),
          ),
        ],
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
      label: 'Loading examinations',
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: 4,
        itemBuilder: (BuildContext context, int index) {
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: <Widget>[
                  Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Container(
                          height: 16,
                          width: 180,
                          decoration: BoxDecoration(
                            color: theme.colorScheme.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(4),
                          ),
                        ),
                        const SizedBox(height: 8),
                        Container(
                          height: 12,
                          width: 120,
                          decoration: BoxDecoration(
                            color: theme.colorScheme.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(4),
                          ),
                        ),
                      ],
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
            Icon(Icons.error_outline, size: 48, color: theme.colorScheme.error),
            const SizedBox(height: 16),
            Text(message, style: theme.textTheme.bodyLarge, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            Semantics(
              button: true,
              label: 'Retry loading examinations',
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
              Icons.event_note_outlined,
              size: 64,
              color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
            ),
            const SizedBox(height: 16),
            Text(
              'No upcoming examinations',
              style: theme.textTheme.bodyLarge?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'Examination schedules will appear here when published.',
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
