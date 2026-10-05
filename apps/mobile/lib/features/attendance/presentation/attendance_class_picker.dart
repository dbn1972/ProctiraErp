import 'package:flutter/material.dart';

/// Class filter for the attendance roster (PRC-M031).
///
/// Offers only classes known from the cached roster, so a free-text typo can
/// no longer produce an empty roster. "All classes" clears the filter.
class AttendanceClassPicker extends StatelessWidget {
  const AttendanceClassPicker({
    super.key,
    required this.classes,
    required this.value,
    required this.onChanged,
  });

  final List<String> classes;
  final String? value;
  final ValueChanged<String?> onChanged;

  static const String allClassesLabel = 'All classes';

  @override
  Widget build(BuildContext context) {
    final bool enabled = classes.isNotEmpty;
    return DropdownButtonFormField<String?>(
      // Re-key so an external reset (roster reload) is reflected.
      key: ValueKey<String?>('class-${value ?? '*'}-${classes.length}'),
      initialValue: classes.contains(value) ? value : null,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: 'Class',
        prefixIcon: const Icon(Icons.groups_outlined),
        helperText: enabled ? null : 'Load the roster to choose a class',
      ),
      items: <DropdownMenuItem<String?>>[
        const DropdownMenuItem<String?>(child: Text(allClassesLabel)),
        for (final String cls in classes)
          DropdownMenuItem<String?>(value: cls, child: Text(cls)),
      ],
      onChanged: enabled ? onChanged : null,
    );
  }
}
