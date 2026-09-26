import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/features/scholarship/data/scholarship_repository.dart';

ScholarshipProgram _program({
  required bool isOpen,
  String? deadline,
}) {
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
      _program(isOpen: true, deadline: '2099-01-01').acceptsApplications,
      isTrue,
    );
  });

  test('open programs with no deadline accept applications', () {
    expect(_program(isOpen: true).acceptsApplications, isTrue);
  });

  test('closed programs do not accept applications', () {
    expect(
      _program(isOpen: false, deadline: '2099-01-01').acceptsApplications,
      isFalse,
    );
  });

  test('past deadlines do not accept applications', () {
    expect(
      _program(isOpen: true, deadline: '2000-01-01').acceptsApplications,
      isFalse,
    );
  });

  test('an unparseable deadline does not throw', () {
    final ScholarshipProgram program =
        _program(isOpen: true, deadline: 'not-a-date');
    expect(program.daysUntilDeadline, isNull);
    expect(program.acceptsApplications, isTrue);
  });
}
