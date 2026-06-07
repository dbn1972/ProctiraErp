import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/app_localizations.dart';
import '../bloc/scholarship_bloc.dart';
import '../data/scholarship_repository.dart';

/// Screen to browse available scholarship programs.
class ScholarshipProgramsScreen extends StatelessWidget {
  const ScholarshipProgramsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider<ScholarshipBloc>(
      create: (BuildContext context) {
        final ScholarshipBloc bloc = ScholarshipBloc(
          repository: context.read<ScholarshipRepository>(),
        );
        bloc.add(const ScholarshipProgramsRequested());
        return bloc;
      },
      child: const _ProgramsView(),
    );
  }
}

class _ProgramsView extends StatelessWidget {
  const _ProgramsView();

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Semantics(header: true, child: Text(l10n.scholarships)),
        actions: <Widget>[
          Semantics(
            button: true,
            label: 'View my applications',
            child: IconButton(
              icon: const Icon(Icons.assignment_outlined),
              tooltip: 'My Applications',
              onPressed: () => context.push('/scholarships/status'),
            ),
          ),
        ],
      ),
      body: BlocBuilder<ScholarshipBloc, ScholarshipState>(
        builder: (BuildContext context, ScholarshipState state) {
          switch (state.status) {
            case ScholarshipStatus.initial:
            case ScholarshipStatus.loading:
              return const _ShimmerLoading();
            case ScholarshipStatus.error:
              return _ErrorView(
                message: state.errorMessage ?? l10n.error,
                onRetry: () {
                  context
                      .read<ScholarshipBloc>()
                      .add(const ScholarshipProgramsRequested());
                },
              );
            case ScholarshipStatus.loaded:
            case ScholarshipStatus.submitting:
            case ScholarshipStatus.submitted:
              if (state.programs.isEmpty) {
                return const _EmptyView();
              }
              return _ProgramsList(programs: state.programs);
          }
        },
      ),
    );
  }
}

class _ProgramsList extends StatelessWidget {
  const _ProgramsList({required this.programs});

  final List<ScholarshipProgram> programs;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: programs.length,
      itemBuilder: (BuildContext context, int index) {
        final ScholarshipProgram program = programs[index];
        final int? daysLeft = program.daysUntilDeadline;

        return Semantics(
          label: '${program.name} by ${program.provider}'
              '${daysLeft != null ? ", $daysLeft days until deadline" : ""}',
          child: Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: () {
                context.push('/scholarships/apply/${program.id}');
              },
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            program.name,
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        if (program.amount != null)
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: theme.colorScheme.primaryContainer,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              '${program.currency ?? "₹"}${program.amount!.toStringAsFixed(0)}',
                              style: theme.textTheme.labelMedium?.copyWith(
                                color: theme.colorScheme.onPrimaryContainer,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      program.provider,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      program.description,
                      style: theme.textTheme.bodyMedium,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (daysLeft != null) ...<Widget>[
                      const SizedBox(height: 8),
                      Row(
                        children: <Widget>[
                          Icon(
                            Icons.timer_outlined,
                            size: 16,
                            color: daysLeft <= 7
                                ? theme.colorScheme.error
                                : theme.colorScheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            daysLeft >= 0
                                ? '$daysLeft days remaining'
                                : 'Deadline passed',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: daysLeft <= 7
                                  ? theme.colorScheme.error
                                  : theme.colorScheme.onSurfaceVariant,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _ShimmerLoading extends StatelessWidget {
  const _ShimmerLoading();

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Semantics(
      label: 'Loading scholarship programs',
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: 4,
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
                    width: 200,
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
                  const SizedBox(height: 12),
                  Container(
                    height: 40,
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
            Icon(Icons.error_outline, size: 48, color: theme.colorScheme.error),
            const SizedBox(height: 16),
            Text(message, style: theme.textTheme.bodyLarge, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            Semantics(
              button: true,
              label: 'Retry loading programs',
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
              Icons.school_outlined,
              size: 64,
              color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
            ),
            const SizedBox(height: 16),
            Text(
              'No scholarship programs available',
              style: theme.textTheme.bodyLarge?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'Check back later for new scholarship opportunities.',
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
