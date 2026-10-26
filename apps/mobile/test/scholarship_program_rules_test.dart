import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/features/scholarship/data/scholarship_repository.dart';

ScholarshipProgram _program({required bool isOpen, String? deadline}) {
  return ScholarshipProgram(
    id: 'prog-1',
    name: 'Merit award',
    description: 'Annual award',
    provider: 'Board',
    isOpen: isOpen,
    deadline: deadline,
  );
}

void main() {
  test('open programs with a future deadline accept applications', () {
    expect(
      _program(isOpen: true, deadline: '2099-01-01').acceptsApplications(),
      isTrue,
    );
  });

  test('open programs with no deadline accept applications', () {
    expect(_program(isOpen: true).acceptsApplications(), isTrue);
  });

  test('closed programs do not accept applications', () {
    expect(
      _program(isOpen: false, deadline: '2099-01-01').acceptsApplications(),
      isFalse,
    );
  });

  test('past deadlines do not accept applications', () {
    expect(
      _program(isOpen: true, deadline: '2000-01-01').acceptsApplications(),
      isFalse,
    );
  });

  test('an unparseable deadline does not throw', () {
    final ScholarshipProgram program = _program(
      isOpen: true,
      deadline: 'not-a-date',
    );
    expect(program.daysUntilDeadline(), isNull);
    expect(program.acceptsApplications(), isTrue);
  });

  test('PRC-L214: a bare-date deadline of "today" (UTC) still accepts '
      'applications for a user simulated at UTC+12', () {
    // "Now" for a UTC+12 user at 2026-05-12T23:00 local time is
    // 2026-05-12T11:00:00Z -- still the same UTC calendar day as the
    // bare-date deadline, so end-of-day UTC (23:59:59Z) has not passed.
    DateTime fakeNow() => DateTime.utc(2026, 5, 12, 11, 0, 0);
    final ScholarshipProgram program = _program(
      isOpen: true,
      deadline: '2026-05-12',
    );
    expect(program.acceptsApplications(now: fakeNow), isTrue);
    expect(program.daysUntilDeadline(now: fakeNow), 0);
  });

  test('PRC-L214: a bare-date deadline that passed yesterday (UTC) rejects '
      'regardless of the simulated local timezone', () {
    DateTime fakeNow() => DateTime.utc(2026, 5, 13, 1, 0, 0);
    final ScholarshipProgram program = _program(
      isOpen: true,
      deadline: '2026-05-12',
    );
    expect(program.acceptsApplications(now: fakeNow), isFalse);
  });
}
