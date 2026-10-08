import 'package:flutter/material.dart';

/// A single academic period option (id + human label).
class AcademicPeriodOption {
  const AcademicPeriodOption({required this.id, required this.label});

  final String id;
  final String label;

  /// Build from a `/api/v1/academic-periods` row, preferring name then code.
  static AcademicPeriodOption? fromJson(Map<String, dynamic> json) {
    final Object? id = json['id'];
    if (id is! String || id.isEmpty) return null;
    final Object? name = json['name'];
    final Object? code = json['code'];
    final String label = (name is String && name.isNotEmpty)
        ? name
        : (code is String && code.isNotEmpty)
        ? code
        : id;
    return AcademicPeriodOption(id: id, label: label);
  }
}

/// Academic period picker (PRC-H060).
///
/// Replaces the free-text academic-period ID field so a teacher chooses from
/// the institution's real periods (fed by `GET /api/v1/academic-periods`)
/// rather than typing a UUID. Marking stays gated: when no period is selected
/// the caller keeps marking disabled.
class AttendanceAcademicPeriodPicker extends StatelessWidget {
  const AttendanceAcademicPeriodPicker({
    super.key,
    required this.periods,
    required this.value,
    required this.onChanged,
    this.loading = false,
    this.error,
  });

  final List<AcademicPeriodOption> periods;
  final String? value;
  final ValueChanged<String?> onChanged;
  final bool loading;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final bool enabled = !loading && periods.isNotEmpty;
    final String helper = loading
        ? 'Loading academic periods…'
        : error ??
              (periods.isEmpty
                  ? 'No academic periods available'
                  : 'Required before marking attendance');
    return DropdownButtonFormField<String?>(
      key: ValueKey<String?>('period-${value ?? '*'}-${periods.length}'),
      initialValue: periods.any((AcademicPeriodOption p) => p.id == value)
          ? value
          : null,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: 'Academic period',
        prefixIcon: const Icon(Icons.event_note_outlined),
        helperText: helper,
        errorText: error,
      ),
      items: <DropdownMenuItem<String?>>[
        for (final AcademicPeriodOption period in periods)
          DropdownMenuItem<String?>(
            value: period.id,
            child: Text(period.label),
          ),
      ],
      onChanged: enabled ? onChanged : null,
    );
  }
}
