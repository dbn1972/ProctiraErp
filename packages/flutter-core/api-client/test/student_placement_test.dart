import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:test/test.dart';

/// PRC-M031: `GET /students` now carries the current enrollment placement
/// (institutionId, gradeId, grade, classId, className). The attendance roster
/// filters the offline cache on `className`, so the DTO must read the backend
/// field names, and a student with no enrollment (null values) stays unplaced.
void main() {
  test('Student.fromJson reads the PRC-M031 placement fields', () {
    final Student student = Student.fromJson(<String, dynamic>{
      'id': 'id-stu',
      'firstName': 'Asha',
      'lastName': 'Rao',
      'institutionId': 'id-inst',
      'gradeId': 'id-grade',
      'grade': 'Grade 5',
      'classId': 'id-class',
      'className': '5-A',
      'createdAt': '2026-04-01T00:00:00Z',
      'updatedAt': '2026-04-01T00:00:00Z',
    });
    expect(student.institutionId, 'id-inst');
    expect(student.grade, 'Grade 5');
    expect(student.className, '5-A');
  });

  test('null placement fields leave the student unplaced', () {
    final Student student = Student.fromJson(<String, dynamic>{
      'id': 'id-stu',
      'firstName': 'Bina',
      'lastName': 'Rao',
      'institutionId': null,
      'gradeId': null,
      'grade': null,
      'classId': null,
      'className': null,
      'createdAt': '2026-04-01T00:00:00Z',
      'updatedAt': '2026-04-01T00:00:00Z',
    });
    expect(student.institutionId, isNull);
    expect(student.grade, isNull);
    expect(student.className, isNull);
  });
}
