import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/di/injector.dart';
import '../../../core/l10n/app_localizations.dart';
import '../bloc/scholarship_bloc.dart';
import '../data/scholarship_repository.dart';

/// Screen to track scholarship application status.
class ScholarshipStatusScreen extends StatelessWidget {
  const ScholarshipStatusScreen({super.key, required this.studentId});

  final String studentId;

  @override
  Widget build(BuildContext context) {
    return BlocProvider<ScholarshipBloc>(
      create: (BuildContext context) {
        final ScholarshipBloc bloc = ScholarshipBloc(
          repository: getIt<ScholarshipRepository>(),
        );
        bloc.add(ScholarshipApplicationsRequested(studentId: studentId));
        return bloc;
      },
      child: const _StatusView(),
    );
  }
}

class _StatusView extends StatelessWidget {
  const _StatusView();

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Semantics(
          header: true,
          child: Text('${l10n.scholarships} ${l10n.status}'),
        ),
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
                  // Re-fetch — studentId comes from the parent widget.
                },
              );
            case ScholarshipStatus.loaded:
            case ScholarshipStatus.submitting:
            case ScholarshipStatus.submitted:
              if (state.applications.isEmpty) {
                return const _EmptyView();
              }
              return _ApplicationsList(applications: state.applications);
          }
        },
      ),
    );
  }
}

class _ApplicationsList extends StatelessWidget {
  const _ApplicationsList({required this.applications});

  final List<ScholarshipApplication> applications;

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      itemCount: applications.length,
      itemBuilder: (BuildContext context, int index) {
        final ScholarshipApplication app = applications[index];
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: _ApplicationCard(app: app),
        );
      },
    );
  }
}

class _ApplicationCard extends StatelessWidget {
  const _ApplicationCard({required this.app});

  final ScholarshipApplication app;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final bool decided =
        app.status == ScholarshipApplicationStatus.approved ||
            app.status == ScholarshipApplicationStatus.rejected;
    final bool rejected =
        app.status == ScholarshipApplicationStatus.rejected;

    return Semantics(
      label: '${app.programName}, status: ${app.status.displayName}',
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              // Header: program name + status chip.
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: Text(
                      app.programName,
                      style: theme.textTheme.titleMedium,
                    ),
                  ),
                  const SizedBox(width: 8),
                  _StatusBadge(status: app.status),
                ],
              ),
              const SizedBox(height: 16),
              // Vertical step timeline derived from the real status enum.
              _TimelineStep(
                label: 'Submitted',
                date: app.submittedAt,
                isCompleted:
                    app.status != ScholarshipApplicationStatus.draft,
                isActive: app.status ==
                    ScholarshipApplicationStatus.submitted,
              ),
              _TimelineStep(
                label: 'Under Review',
                date: null,
                isCompleted: decided,
                isActive: app.status ==
                    ScholarshipApplicationStatus.underReview,
              ),
              _TimelineStep(
                label: rejected ? 'Rejected' : 'Approved',
                date: app.reviewedAt,
                isCompleted: decided,
                isActive: false,
                isLast: true,
                isError: rejected,
              ),
              if (app.reviewerNotes != null &&
                  app.reviewerNotes!.isNotEmpty) ...<Widget>[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest
                        .withValues(alpha: 0.5),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: theme.dividerColor),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Icon(
                        Icons.comment_outlined,
                        size: 16,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          app.reviewerNotes!,
                          style: theme.textTheme.bodySmall,
                        ),
                      ),
                    ],
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

/// Pill chip: tinted background + bold colored label (v2.0 palette).
class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});

  final ScholarshipApplicationStatus status;

  @override
  Widget build(BuildContext context) {
    final Color color;
    switch (status) {
      case ScholarshipApplicationStatus.approved:
        color = const Color(0xFF10B981); // green
        break;
      case ScholarshipApplicationStatus.rejected:
        color = const Color(0xFFEF4444); // red
        break;
      case ScholarshipApplicationStatus.underReview:
        color = const Color(0xFFF59E0B); // amber
        break;
      case ScholarshipApplicationStatus.submitted:
        color = const Color(0xFF0EA5E9); // sky
        break;
      case ScholarshipApplicationStatus.withdrawn:
        color = const Color(0xFF64748B); // slate
        break;
      case ScholarshipApplicationStatus.draft:
        color = const Color(0xFF64748B); // slate
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        status.displayName,
        style: TextStyle(
          color: color,
          fontWeight: FontWeight.w700,
          fontSize: 12,
        ),
      ),
    );
  }
}

class _TimelineStep extends StatelessWidget {
  const _TimelineStep({
    required this.label,
    required this.date,
    required this.isCompleted,
    required this.isActive,
    this.isLast = false,
    this.isError = false,
  });

  final String label;
  final String? date;
  final bool isCompleted;
  final bool isActive;
  final bool isLast;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    const Color green = Color(0xFF10B981);
    const Color red = Color(0xFFEF4444);
    final Color brand = theme.colorScheme.primary;

    final Color dotColor = isError
        ? red
        : isCompleted
            ? green
            : isActive
                ? brand
                : theme.colorScheme.outlineVariant;
    final bool filled = isCompleted || isActive || isError;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Column(
          children: <Widget>[
            Container(
              width: 22,
              height: 22,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: filled ? dotColor : Colors.transparent,
                border: Border.all(color: dotColor, width: 2),
              ),
              child: isCompleted
                  ? const Icon(Icons.check, size: 13, color: Colors.white)
                  : isActive
                      ? const Icon(Icons.schedule,
                          size: 13, color: Colors.white)
                      : null,
            ),
            if (!isLast)
              Container(
                width: 2,
                height: 26,
                color: isCompleted
                    ? green
                    : theme.colorScheme.outlineVariant,
              ),
          ],
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12, top: 2),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: <Widget>[
                Flexible(
                  child: Text(
                    label,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: isActive || isCompleted
                          ? FontWeight.w700
                          : FontWeight.w500,
                      color: isError
                          ? red
                          : isActive
                              ? brand
                              : isCompleted
                                  ? theme.colorScheme.onSurface
                                  : theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
                if (date != null)
                  Text(
                    date!.substring(0, 10),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
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
      label: 'Loading applications',
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: 3,
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
                    width: 180,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(height: 16),
                  ...List<Widget>.generate(3, (int i) => Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Row(
                      children: <Widget>[
                        Container(
                          width: 12,
                          height: 12,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: theme.colorScheme.surfaceContainerHighest,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Container(
                          height: 12,
                          width: 100,
                          decoration: BoxDecoration(
                            color: theme.colorScheme.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(4),
                          ),
                        ),
                      ],
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
              label: 'Retry',
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
              Icons.assignment_outlined,
              size: 64,
              color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
            ),
            const SizedBox(height: 16),
            Text(
              'No applications yet',
              style: theme.textTheme.bodyLarge?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'Browse available programs and submit your first application.',
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
