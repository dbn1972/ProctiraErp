import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/features/examination/data/examination_repository.dart';

Examination _exam(String date, {String status = 'upcoming'}) =>
    Examination.fromJson(<String, dynamic>{
      'id': 'e1',
      'name': 'Midterm',
      'subjectName': 'Maths',
      'examDate': date,
      'startTime': '09:00',
      'endTime': '11:00',
      'status': status,
    });

/// PRC-L010: calendar-day countdown with an injected clock.
void main() {
  test('15:00 on D-1 gives 1 day', () {
    expect(_exam('2026-03-10').daysUntilFrom(DateTime(2026, 3, 9, 15)), 1);
  });

  test('23:59 on D-1 still gives 1 day', () {
    expect(_exam('2026-03-10').daysUntilFrom(DateTime(2026, 3, 9, 23, 59)), 1);
  });

  test('any time on day D gives 0', () {
    expect(_exam('2026-03-10').daysUntilFrom(DateTime(2026, 3, 10)), 0);
    expect(_exam('2026-03-10').daysUntilFrom(DateTime(2026, 3, 10, 18)), 0);
  });

  test('day after gives -1', () {
    expect(_exam('2026-03-10').daysUntilFrom(DateTime(2026, 3, 11, 1)), -1);
  });

  test('across a month boundary', () {
    expect(_exam('2026-04-01').daysUntilFrom(DateTime(2026, 3, 31, 20)), 1);
  });

  test('isUpcoming follows server status, not date maths', () {
    expect(_exam('2000-01-01').isUpcoming, isTrue);
    expect(_exam('2999-01-01', status: 'completed').isUpcoming, isFalse);
    expect(_exam('2999-01-01', status: 'cancelled').isUpcoming, isFalse);
    expect(_exam('2999-01-01', status: 'ongoing').isUpcoming, isTrue);
  });
}
