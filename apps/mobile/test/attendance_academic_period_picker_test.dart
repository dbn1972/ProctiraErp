import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:proctira_mobile/features/attendance/presentation/attendance_academic_period_picker.dart';

void main() {
  group('AttendanceAcademicPeriodPicker (PRC-H060)', () {
    testWidgets(
      'renders a period dropdown (not a free-text field) and selects',
      (WidgetTester tester) async {
        String? selected;
        final List<AcademicPeriodOption> periods = <AcademicPeriodOption>[
          const AcademicPeriodOption(id: 'p1', label: '2025–26'),
          const AcademicPeriodOption(id: 'p2', label: '2026–27'),
        ];

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: AttendanceAcademicPeriodPicker(
                periods: periods,
                value: selected,
                onChanged: (String? v) => selected = v,
              ),
            ),
          ),
        );

        // It is a dropdown picker, not a typed id field.
        expect(find.byType(DropdownButtonFormField<String?>), findsOneWidget);
        expect(find.text('Academic period'), findsOneWidget);

        await tester.tap(find.byType(DropdownButtonFormField<String?>));
        await tester.pumpAndSettle();
        await tester.tap(find.text('2026–27').last);
        await tester.pumpAndSettle();

        expect(selected, 'p2');
      },
    );

    testWidgets('is disabled with a helper when no periods are available', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: AttendanceAcademicPeriodPicker(
              periods: <AcademicPeriodOption>[],
              value: null,
              onChanged: _noop,
            ),
          ),
        ),
      );

      expect(find.text('No academic periods available'), findsOneWidget);
      final DropdownButtonFormField<String?> field = tester
          .widget<DropdownButtonFormField<String?>>(
            find.byType(DropdownButtonFormField<String?>),
          );
      expect(field.onChanged, isNull); // disabled
    });

    test('AcademicPeriodOption.fromJson prefers name then code then id', () {
      expect(
        AcademicPeriodOption.fromJson(<String, dynamic>{
          'id': 'a',
          'name': 'Year 1',
          'code': 'Y1',
        })?.label,
        'Year 1',
      );
      expect(
        AcademicPeriodOption.fromJson(<String, dynamic>{
          'id': 'a',
          'code': 'Y1',
        })?.label,
        'Y1',
      );
      expect(
        AcademicPeriodOption.fromJson(<String, dynamic>{'id': 'a'})?.label,
        'a',
      );
      expect(
        AcademicPeriodOption.fromJson(<String, dynamic>{'name': 'x'}),
        isNull,
      );
    });
  });
}

void _noop(String? _) {}
