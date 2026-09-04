import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/di/injector.dart';
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
          repository: getIt<HealthRepository>(),
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

    return Scaffold(
      appBar: AppBar(
        title: Semantics(header: true, child: Text(l10n.healthRecords)),
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
              return _RecordsView(records: state.records);
          }
        },
      ),
    );
  }
}

/// Single sectioned scroll view (v2.0): confidentiality note, vitals,
/// immunization, and conditions.
class _RecordsView extends StatelessWidget {
  const _RecordsView({required this.records});

  final HealthRecords records;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: <Widget>[
        // Confidentiality note.
        const _InfoBanner(
          icon: Icons.lock_outline,
          message: 'Confidential — visible only to you and the school nurse',
        ),
        if (records.measurements.isNotEmpty) ...<Widget>[
          const SizedBox(height: 16),
          _MeasurementsSection(measurements: records.measurements),
        ],
        if (records.vaccinations.isNotEmpty) ...<Widget>[
          const SizedBox(height: 20),
          const _SectionHeader(title: 'Immunization'),
          const SizedBox(height: 8),
          _VaccinationsSection(vaccinations: records.vaccinations),
        ],
        if (records.conditions.isNotEmpty) ...<Widget>[
          const SizedBox(height: 20),
          const _SectionHeader(title: 'Conditions'),
          const SizedBox(height: 8),
          _ConditionsSection(conditions: records.conditions),
        ],
      ],
    );
  }
}

/// Sky-tinted informational/confidentiality banner (v2.0).
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

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: Theme.of(context).textTheme.titleMedium,
    );
  }
}

/// Vitals shown as a responsive KPI grid (v2.0). Latest value per type.
class _MeasurementsSection extends StatelessWidget {
  const _MeasurementsSection({required this.measurements});

  final List<HealthMeasurement> measurements;

  @override
  Widget build(BuildContext context) {
    // Group by type, latest first.
    final Map<String, List<HealthMeasurement>> grouped =
        <String, List<HealthMeasurement>>{};
    for (final HealthMeasurement m in measurements) {
      grouped.putIfAbsent(m.type, () => <HealthMeasurement>[]);
      grouped[m.type]!.add(m);
    }

    final List<String> types = grouped.keys.toList(growable: false);

    return GridView.builder(
      padding: EdgeInsets.zero,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
        childAspectRatio: 1.5,
      ),
      itemCount: types.length,
      itemBuilder: (BuildContext context, int index) {
        final String type = types[index];
        final HealthMeasurement latest = grouped[type]!.first;
        return _MeasurementKpi(type: type, latest: latest);
      },
    );
  }
}

class _MeasurementKpi extends StatelessWidget {
  const _MeasurementKpi({required this.type, required this.latest});

  final String type;
  final HealthMeasurement latest;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final Color accent = theme.colorScheme.primary;

    // Trim trailing .0 for whole numbers.
    final String value = latest.value == latest.value.roundToDouble()
        ? latest.value.toStringAsFixed(0)
        : latest.value.toString();

    return Semantics(
      label: '${_formatType(type)}: $value ${latest.unit}',
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: <Widget>[
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(_measurementIcon(type), color: accent, size: 19),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    '$value ${latest.unit}',
                    style: theme.textTheme.titleMedium,
                  ),
                  Text(
                    _formatType(type),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
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

/// Immunization records as a list of cards (v2.0).
class _VaccinationsSection extends StatelessWidget {
  const _VaccinationsSection({required this.vaccinations});

  final List<VaccinationRecord> vaccinations;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    const Color green = Color(0xFF10B981);

    return Column(
      children: vaccinations.map((VaccinationRecord vax) {
        final bool hasNextDue = vax.nextDueDate != null;
        return Semantics(
          label:
              '${vax.vaccineName} dose ${vax.doseNumber}, administered ${vax.administeredAt.substring(0, 10)}',
          child: Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: green.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(Icons.vaccines_outlined,
                        color: green, size: 20),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          vax.vaccineName,
                          style: theme.textTheme.titleMedium,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Dose ${vax.doseNumber} · ${vax.administeredAt.substring(0, 10)}'
                          '${vax.administeredBy != null ? " · ${vax.administeredBy}" : ""}',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  _SeverityChip(
                    color: hasNextDue
                        ? const Color(0xFFF59E0B)
                        : green,
                    label: hasNextDue
                        ? 'Due ${vax.nextDueDate!.substring(0, 10)}'
                        : 'Completed',
                  ),
                ],
              ),
            ),
          ),
        );
      }).toList(growable: false),
    );
  }
}

/// Chronic/active conditions with severity chips (v2.0).
class _ConditionsSection extends StatelessWidget {
  const _ConditionsSection({required this.conditions});

  final List<HealthCondition> conditions;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    return Column(
      children: conditions.map((HealthCondition condition) {
        final ({Color color, String label}) sev =
            _severity(condition.severity);
        return Semantics(
          label: '${condition.name}, severity: ${condition.severity}, '
              '${condition.isActive ? "active" : "resolved"}',
          child: Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: sev.color.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(Icons.medical_information_outlined,
                        color: sev.color, size: 20),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          condition.name,
                          style: theme.textTheme.titleMedium,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${condition.isActive ? "Active" : "Resolved"}'
                          '${condition.diagnosedAt != null ? " · ${condition.diagnosedAt!.substring(0, 10)}" : ""}',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                        if (condition.notes != null &&
                            condition.notes!.isNotEmpty) ...<Widget>[
                          const SizedBox(height: 4),
                          Text(
                            condition.notes!,
                            style: theme.textTheme.bodySmall,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  _SeverityChip(
                    color: sev.color,
                    label: sev.label,
                  ),
                ],
              ),
            ),
          ),
        );
      }).toList(growable: false),
    );
  }

  ({Color color, String label}) _severity(String severity) {
    switch (severity.toLowerCase()) {
      case 'severe':
        return (color: const Color(0xFFEF4444), label: 'Severe'); // red
      case 'moderate':
        return (color: const Color(0xFFF59E0B), label: 'Moderate'); // amber
      default:
        return (color: const Color(0xFFF59E0B), label: 'Mild'); // mild amber
    }
  }
}

/// Pill chip: tinted background + bold colored label (v2.0 palette).
class _SeverityChip extends StatelessWidget {
  const _SeverityChip({required this.color, required this.label});

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
