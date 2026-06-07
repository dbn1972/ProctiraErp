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

// ProctiraERP Design System v2.0 status palette.
const Color _green = Color(0xFF10B981);
const Color _amber = Color(0xFFF59E0B);
const Color _red = Color(0xFFEF4444);
const Color _violet = Color(0xFF8B5CF6);

/// Color for an examination status chip.
Color _statusColor(ExamStatus status) {
  switch (status) {
    case ExamStatus.upcoming:
      return _violet;
    case ExamStatus.ongoing:
      return _amber;
    case ExamStatus.completed:
      return _green;
    case ExamStatus.cancelled:
      return _red;
  }
}

String _statusLabel(ExamStatus status) {
  switch (status) {
    case ExamStatus.upcoming:
      return 'Scheduled';
    case ExamStatus.ongoing:
      return 'Ongoing';
    case ExamStatus.completed:
      return 'Done';
    case ExamStatus.cancelled:
      return 'Cancelled';
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
        final Color statusColor = _statusColor(exam.status);

        return Semantics(
          label: '${exam.name}, ${exam.subjectName}, '
              '${daysLeft >= 0 ? "$daysLeft days remaining" : "completed"}',
          child: Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: InkWell(
              borderRadius: BorderRadius.circular(18),
              onTap: () {
                // Show exam details in a bottom sheet.
                _showExamDetails(context, exam);
              },
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            color: statusColor.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Icon(
                            Icons.description_outlined,
                            size: 22,
                            color: statusColor,
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(
                                exam.name,
                                style: theme.textTheme.titleMedium,
                              ),
                              const SizedBox(height: 3),
                              Text(
                                exam.subjectName,
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant,
                                  fontFamily: 'monospace',
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        _StatChip(
                          label: _statusLabel(exam.status),
                          color: statusColor,
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 16,
                      runSpacing: 6,
                      children: <Widget>[
                        _MetaRow(
                          icon: Icons.calendar_today_outlined,
                          text: exam.examDate,
                        ),
                        _MetaRow(
                          icon: Icons.schedule_outlined,
                          text: '${exam.startTime} – ${exam.endTime}',
                        ),
                        if (daysLeft >= 0)
                          _MetaRow(
                            icon: Icons.hourglass_empty_outlined,
                            text: daysLeft == 0
                                ? 'Today'
                                : 'In $daysLeft day${daysLeft == 1 ? "" : "s"}',
                          ),
                        if (exam.venue != null)
                          _MetaRow(
                            icon: Icons.location_on_outlined,
                            text: exam.venue!,
                          ),
                      ],
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
                Row(
                  children: <Widget>[
                    Expanded(
                      child: Text(exam.name, style: theme.textTheme.headlineSmall),
                    ),
                    const SizedBox(width: 12),
                    _StatChip(
                      label: _statusLabel(exam.status),
                      color: _statusColor(exam.status),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  exam.subjectName,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontFamily: 'monospace',
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
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

class _MetaRow extends StatelessWidget {
  const _MetaRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(icon, size: 14, color: theme.colorScheme.onSurfaceVariant),
        const SizedBox(width: 5),
        Text(
          text,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
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
