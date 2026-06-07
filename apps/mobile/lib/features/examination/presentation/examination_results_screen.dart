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

class _ResultsList extends StatelessWidget {
  const _ResultsList({required this.results});

  final List<ExaminationResult> results;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

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

        return Semantics(
          label: 'Examination: $examName, ${examResults.length} subjects',
          child: Card(
            margin: const EdgeInsets.only(bottom: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                  child: Text(
                    examName,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const Divider(height: 1),
                // Results table
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Table(
                    columnWidths: const <int, TableColumnWidth>{
                      0: FlexColumnWidth(3),
                      1: FlexColumnWidth(2),
                      2: FlexColumnWidth(1.5),
                      3: FlexColumnWidth(1),
                    },
                    children: <TableRow>[
                      TableRow(
                        children: <Widget>[
                          _TableHeader('Subject'),
                          _TableHeader('Score'),
                          _TableHeader('Grade'),
                          _TableHeader('Rank'),
                        ],
                      ),
                      ...examResults.map((ExaminationResult r) => TableRow(
                            children: <Widget>[
                              _TableCell(r.subjectName),
                              _TableCell(
                                '${r.score.toStringAsFixed(1)}'
                                '${r.maxScore != null ? "/${r.maxScore!.toStringAsFixed(0)}" : ""}',
                              ),
                              _TableCell(r.grade ?? '—'),
                              _TableCell(
                                  r.rank != null ? '#${r.rank}' : '—'),
                            ],
                          )),
                    ],
                  ),
                ),
                if (examResults.any((ExaminationResult r) =>
                    r.remarks != null && r.remarks!.isNotEmpty))
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: examResults
                          .where((ExaminationResult r) =>
                              r.remarks != null && r.remarks!.isNotEmpty)
                          .map((ExaminationResult r) => Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Text(
                                  '${r.subjectName}: ${r.remarks}',
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    fontStyle: FontStyle.italic,
                                  ),
                                ),
                              ))
                          .toList(growable: false),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _TableHeader extends StatelessWidget {
  const _TableHeader(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
              fontWeight: FontWeight.w600,
            ),
      ),
    );
  }
}

class _TableCell extends StatelessWidget {
  const _TableCell(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Text(text, style: Theme.of(context).textTheme.bodyMedium),
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
