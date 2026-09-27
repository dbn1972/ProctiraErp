import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/app_localizations.dart';
import '../../../core/student/student_route.dart';
import '../../students/data/student_repository.dart';
import '../../students/presentation/student_picker.dart';
import '../bloc/scholarship_bloc.dart';
import '../data/scholarship_repository.dart';

/// Screen to browse available scholarship programs.
class ScholarshipProgramsScreen extends StatelessWidget {
  const ScholarshipProgramsScreen({super.key, this.studentId = ''});

  final String studentId;

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
      child: _ProgramsView(studentId: studentId),
    );
  }
}

class _ProgramsView extends StatelessWidget {
  const _ProgramsView({required this.studentId});

  final String studentId;

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
              onPressed: () => context.push(
                withStudentQuery('/scholarships/status', studentId),
              ),
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
              return _ProgramsList(
                programs: state.programs,
                studentId: studentId,
              );
          }
        },
      ),
    );
  }
}

class _ProgramsList extends StatelessWidget {
  const _ProgramsList({required this.programs, required this.studentId});

  final List<ScholarshipProgram> programs;
  final String studentId;

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      itemCount: programs.length + 1,
      itemBuilder: (BuildContext context, int index) {
        if (index == 0) {
          return const Padding(
            padding: EdgeInsets.only(bottom: 16),
            child: _InfoBanner(
              icon: Icons.info_outline,
              message: 'You can apply on behalf of eligible students',
            ),
          );
        }
        final ScholarshipProgram program = programs[index - 1];
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: _ProgramCard(program: program, studentId: studentId),
        );
      },
    );
  }
}

class _ProgramCard extends StatelessWidget {
  const _ProgramCard({required this.program, required this.studentId});

  final ScholarshipProgram program;
  final String studentId;

  Future<void> _open(BuildContext context) async {
    if (!program.acceptsApplications) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'This scholarship is closed or the deadline has passed.',
          ),
        ),
      );
      return;
    }
    String id = studentId.trim();
    if (id.isEmpty) {
      final CachedStudent? picked = await showStudentPicker(context);
      if (picked == null || !context.mounted) {
        return;
      }
      id = picked.id;
    }
    if (!context.mounted) {
      return;
    }
    context.push(withStudentQuery('/scholarships/apply/${program.id}', id));
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final int? daysLeft = program.daysUntilDeadline;
    final bool urgent = daysLeft != null && daysLeft >= 0 && daysLeft <= 7;
    final bool passed = daysLeft != null && daysLeft < 0;

    // Status chip derived from real model fields.
    final bool closed = !program.acceptsApplications;
    final ({Color color, String label}) chip = closed
        ? (color: const Color(0xFF64748B), label: 'Closed')
        : urgent
            ? (color: const Color(0xFFF59E0B), label: 'Closing soon')
            : (color: const Color(0xFF10B981), label: 'Open');

    final List<String> meta = <String>[
      program.provider,
      if (program.amount != null)
        '${program.currency ?? "₹"}${program.amount!.toStringAsFixed(0)}/yr',
      if (daysLeft != null)
        passed
            ? 'Deadline passed'
            : daysLeft == 0
                ? 'Closes today'
                : 'Apply in $daysLeft days',
    ];

    return Semantics(
      label: '${program.name} by ${program.provider}'
          '${daysLeft != null ? ", $daysLeft days until deadline" : ""}',
      child: Card(
        child: InkWell(
          onTap: () {
            unawaited(_open(context));
          },
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primary.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    Icons.workspace_premium_outlined,
                    color: theme.colorScheme.primary,
                    size: 22,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        program.name,
                        style: theme.textTheme.titleMedium,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        meta.join(' · '),
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: urgent
                              ? const Color(0xFFF59E0B)
                              : theme.colorScheme.onSurfaceVariant,
                          fontWeight:
                              urgent ? FontWeight.w700 : FontWeight.w500,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                _StatusChip(color: chip.color, label: chip.label),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Sky-tinted informational banner (v2.0).
class _InfoBanner extends StatelessWidget {
  const _InfoBanner({required this.icon, required this.message});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    const Color sky = Color(0xFF0EA5E9);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: sky.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: sky.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: <Widget>[
          Icon(icon, size: 16, color: sky),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: sky,
                    fontWeight: FontWeight.w600,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Pill chip: tinted background + bold colored label (v2.0 palette).
class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontWeight: FontWeight.w700,
          fontSize: 12,
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
