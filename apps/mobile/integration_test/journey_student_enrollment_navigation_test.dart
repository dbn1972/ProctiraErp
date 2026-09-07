import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:sqflite/sqflite.dart';

import 'helpers/test_setup.dart';

/// Drives the student → profile → enrollment history navigation:
///
/// 1. Seed `students_cache` with one student and `enrollments_cache` with
///    two history rows in different academic periods.
/// 2. Open `/students`, tap the row, assert the profile loads.
/// 3. Tap "View enrollment history", assert both grouped entries display.
///
/// Validates: Requirements 6.1
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'students → profile → enrollment history navigation',
    (WidgetTester tester) async {
      final JourneyHarness harness = await bootstrapTestApp(
        tenantId: 'tenant-a',
        tenantDisplayName: 'Tenant A',
      );
      addTearDown(harness.dispose);

      await harness.markAuthenticated();

      // Seed students_cache with one student, plus two enrollment rows.
      final Database raw = await harness.database.database;
      await raw.insert('students_cache', <String, Object?>{
        'id': 'stu-1',
        'tenant_id': 'tenant-a',
        'institution_id': 'inst-1',
        'full_name': 'Grace Hopper',
        'national_id': 'GH-9',
        'grade': '8',
        'class_name': '8A',
        'payload': jsonEncode(<String, dynamic>{
          'id': 'stu-1',
          'firstName': 'Grace',
          'lastName': 'Hopper',
          'dateOfBirth': '2010-12-09',
          'gender': 'F',
          'institutionId': 'inst-1',
          'createdAt': '2026-01-01T00:00:00Z',
          'updatedAt': '2026-01-01T00:00:00Z',
        }),
        'updated_at': 1,
      });

      await raw.insert('enrollments_cache', <String, Object?>{
        'id': 'enr-1',
        'tenant_id': 'tenant-a',
        'student_id': 'stu-1',
        'institution_id': 'inst-1',
        'academic_period_id': 'ap-2025',
        'status': 'ACTIVE',
        'enrolled_at': '2025-09-01',
        'exited_at': null,
        'payload': jsonEncode(<String, dynamic>{
          'institutionName': 'Central School',
          'academicPeriodName': '2025/2026',
        }),
        'updated_at': 1,
      });
      await raw.insert('enrollments_cache', <String, Object?>{
        'id': 'enr-2',
        'tenant_id': 'tenant-a',
        'student_id': 'stu-1',
        'institution_id': 'inst-2',
        'academic_period_id': 'ap-2024',
        'status': 'COMPLETED',
        'enrolled_at': '2024-09-01',
        'exited_at': '2025-06-30',
        'payload': jsonEncode(<String, dynamic>{
          'institutionName': 'Riverside Academy',
          'academicPeriodName': '2024/2025',
        }),
        'updated_at': 1,
      });

      await pumpJourneyApp(tester);
      goJourney('/students');
      await tester.pumpAndSettle();

      // Student row appears.
      expect(find.text('Grace Hopper'), findsOneWidget);

      // Tap to open the profile.
      await tester.tap(find.text('Grace Hopper'));
      await tester.pumpAndSettle();

      // Profile renders the headline + the Student ID row.
      expect(find.text('Student profile'), findsOneWidget);
      expect(find.text('Grace Hopper'), findsOneWidget);
      expect(find.text('stu-1'), findsOneWidget);

      // Scroll the profile ListView so the bottom CTA is built/hit-testable.
      await tester.drag(find.byType(ListView).first, const Offset(0, -500));
      await tester.pumpAndSettle();
      final Finder historyCta = find.text('View enrollment history');
      expect(historyCta, findsOneWidget);
      await tester.tap(historyCta);
      await tester.pumpAndSettle();

      // Both academic periods are listed (grouped headers).
      expect(find.text('Enrollment history'), findsOneWidget);
      expect(find.text('2025/2026'), findsOneWidget);
      expect(find.text('2024/2025'), findsOneWidget);
      expect(find.text('Central School'), findsOneWidget);
      expect(find.text('Riverside Academy'), findsOneWidget);
    },
  );
}

