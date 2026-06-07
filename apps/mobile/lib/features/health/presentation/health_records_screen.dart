import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/l10n/app_localizations.dart';
import '../bloc/health_bloc.dart';
import '../data/health_repository.dart';

/// Read-only health records viewer for parents.
///
/// Displays measurements, vaccinations, and health conditions in tabbed view.
class HealthRecordsScreen extends StatelessWidget {
  const HealthRecordsScreen({super.key, required this.studentId});

  final String studentId;

  @override
  Widget build(BuildContext context) {
    return BlocProvider<HealthBloc>(
      create: (BuildContext context) {
        final HealthBloc bloc = HealthBloc(
          repository: context.read<HealthRepository>(),
        );
        bloc.add(HealthRecordsRequested(studentId: studentId));
        return bloc;
      },
      child: const _HealthRecordsView(),
    );
  }
}

class _HealthRecordsView extends StatelessWidget {
  const _HealthRecordsView();

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: Semantics(header: true, child: Text(l10n.healthRecords)),
          bottom: const TabBar(
            tabs: <Widget>[
              Tab(
                icon: Icon(Icons.straighten_outlined),
                text: 'Measurements',
              ),
              Tab(
                icon: Icon(Icons.vaccines_outlined),
                text: 'Vaccinations',
              ),
              Tab(
                icon: Icon(Icons.medical_information_outlined),
                text: 'Conditions',
              ),
            ],
          ),
        ),
        body: BlocBuilder<HealthBloc, HealthState>(
          builder: (BuildContext context, HealthState state) {
            switch (state.status) {
              case HealthStatus.initial:
              case HealthStatus.loading:
                return const _ShimmerLoading();
              case HealthStatus.error:
                return _ErrorView(
                  message: state.errorMessage ?? l10n.error,
                  onRetry: () {
                    context.read<HealthBloc>().add(
                          HealthRecordsRequested(studentId: state.studentId),
                        );
                  },
                );
              case HealthStatus.loaded:
                if (state.records.isEmpty) {
                  return const _EmptyView();
                }
                return TabBarView(
                  children: <Widget>[
                    _MeasurementsTab(
                        measurements: state.records.measurements),
                    _VaccinationsTab(
                        vaccinations: state.records.vaccinations),
                    _ConditionsTab(conditions: state.records.conditions),
                  ],
                );
            }
          },
        ),
      ),
    );
  }
}

class _MeasurementsTab extends StatelessWidget {
  const _MeasurementsTab({required this.measurements});

  final List<HealthMeasurement> measurements;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    if (measurements.isEmpty) {
      return Center(
        child: Text(
          'No measurements recorded',
          style: theme.textTheme.bodyLarge?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      );
    }

    // Group by type.
    final Map<String, List<HealthMeasurement>> grouped =
        <String, List<HealthMeasurement>>{};
    for (final HealthMeasurement m in measurements) {
      grouped.putIfAbsent(m.type, () => <HealthMeasurement>[]);
      grouped[m.type]!.add(m);
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: grouped.length,
      itemBuilder: (BuildContext context, int index) {
        final String type = grouped.keys.elementAt(index);
        final List<HealthMeasurement> items = grouped[type]!;
        final HealthMeasurement latest = items.first;

        return Semantics(
          label: '$type: ${latest.value} ${latest.unit}',
          child: Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      Icon(
                        _measurementIcon(type),
                        color: theme.colorScheme.primary,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          _formatType(type),
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      Text(
                        '${latest.value} ${latest.unit}',
                        style: theme.textTheme.headlineSmall?.copyWith(
                          color: theme.colorScheme.primary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Last recorded: ${latest.recordedAt.substring(0, 10)}',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  if (items.length > 1) ...<Widget>[
                    const SizedBox(height: 8),
                    Text(
                      '${items.length} records total',
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

  IconData _measurementIcon(String type) {
    switch (type.toLowerCase()) {
      case 'height':
        return Icons.height;
      case 'weight':
        return Icons.monitor_weight_outlined;
      case 'bmi':
        return Icons.speed_outlined;
      case 'blood_pressure':
        return Icons.favorite_outline;
      default:
        return Icons.straighten_outlined;
    }
  }

  String _formatType(String type) {
    return type.replaceAll('_', ' ').split(' ').map((String word) {
      if (word.isEmpty) return word;
      return word[0].toUpperCase() + word.substring(1);
    }).join(' ');
  }
}

class _VaccinationsTab extends StatelessWidget {
  const _VaccinationsTab({required this.vaccinations});

  final List<VaccinationRecord> vaccinations;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    if (vaccinations.isEmpty) {
      return Center(
        child: Text(
          'No vaccination records',
          style: theme.textTheme.bodyLarge?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: vaccinations.length,
      itemBuilder: (BuildContext context, int index) {
        final VaccinationRecord vax = vaccinations[index];

        return Semantics(
          label:
              '${vax.vaccineName} dose ${vax.doseNumber}, administered ${vax.administeredAt.substring(0, 10)}',
          child: Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: theme.colorScheme.primaryContainer,
                child: Icon(
                  Icons.vaccines_outlined,
                  color: theme.colorScheme.onPrimaryContainer,
                ),
              ),
              title: Text(vax.vaccineName),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Dose ${vax.doseNumber} • ${vax.administeredAt.substring(0, 10)}'),
                  if (vax.nextDueDate != null)
                    Text(
                      'Next due: ${vax.nextDueDate!.substring(0, 10)}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.tertiary,
                      ),
                    ),
                ],
              ),
              isThreeLine: vax.nextDueDate != null,
            ),
          ),
        );
      },
    );
  }
}

class _ConditionsTab extends StatelessWidget {
  const _ConditionsTab({required this.conditions});

  final List<HealthCondition> conditions;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    if (conditions.isEmpty) {
      return Center(
        child: Text(
          'No health conditions recorded',
          style: theme.textTheme.bodyLarge?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: conditions.length,
      itemBuilder: (BuildContext context, int index) {
        final HealthCondition condition = conditions[index];

        return Semantics(
          label:
              '${condition.name}, severity: ${condition.severity}, '
              '${condition.isActive ? "active" : "resolved"}',
          child: Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: _severityColor(theme, condition.severity),
                child: Icon(
                  Icons.medical_information_outlined,
                  color: theme.colorScheme.onErrorContainer,
                  size: 20,
                ),
              ),
              title: Text(condition.name),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: _severityColor(theme, condition.severity),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          condition.severity.toUpperCase(),
                          style: theme.textTheme.labelSmall?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        condition.isActive ? 'Active' : 'Resolved',
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                  ),
                  if (condition.notes != null && condition.notes!.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        condition.notes!,
                        style: theme.textTheme.bodySmall,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
              ),
              isThreeLine: true,
            ),
          ),
        );
      },
    );
  }

  Color _severityColor(ThemeData theme, String severity) {
    switch (severity.toLowerCase()) {
      case 'severe':
        return theme.colorScheme.errorContainer;
      case 'moderate':
        return theme.colorScheme.tertiaryContainer;
      default:
        return theme.colorScheme.secondaryContainer;
    }
  }
}

class _ShimmerLoading extends StatelessWidget {
  const _ShimmerLoading();

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Semantics(
      label: 'Loading health records',
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: 5,
        itemBuilder: (BuildContext context, int index) {
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: <Widget>[
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: theme.colorScheme.surfaceContainerHighest,
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Container(
                          height: 14,
                          width: 140,
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
              label: 'Retry loading health records',
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
              Icons.health_and_safety_outlined,
              size: 64,
              color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
            ),
            const SizedBox(height: 16),
            Text(
              'No health records available',
              style: theme.textTheme.bodyLarge?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'Health records will appear here once recorded by the school nurse.',
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
