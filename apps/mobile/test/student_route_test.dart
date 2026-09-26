import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/student/student_route.dart';

void main() {
  test('withStudentQuery appends a missing student id', () {
    expect(
      withStudentQuery('/assessments', 'stu-1'),
      '/assessments?studentId=stu-1',
    );
    expect(
      withStudentQuery('/examinations/results', 'stu-1'),
      '/examinations/results?studentId=stu-1',
    );
  });

  test('withStudentQuery keeps an existing student id', () {
    expect(
      withStudentQuery('/health?studentId=keep', 'other'),
      '/health?studentId=keep',
    );
  });

  test('withStudentQuery leaves the path alone when no student is selected', () {
    expect(withStudentQuery('/scholarships', null), '/scholarships');
    expect(withStudentQuery('/scholarships', '  '), '/scholarships');
  });
}
