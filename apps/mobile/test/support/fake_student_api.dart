import 'package:dio/dio.dart';
import 'package:proctira_api_client/proctira_api_client.dart';

/// In-memory [StudentApi] that serves [students] page by page.
class FakeStudentApi extends StudentApi {
  FakeStudentApi(this.students) : super(Dio());

  List<Student> students;

  /// When set, every call throws this instead of returning data.
  ApiException? failWith;

  final List<int> requestedPages = <int>[];

  @override
  Future<List<Student>> listStudents({
    int page = 1,
    int pageSize = 20,
    String? institutionId,
  }) async {
    requestedPages.add(page);
    final ApiException? error = failWith;
    if (error != null) throw error;
    final List<Student> scoped = students
        .where(
          (Student s) =>
              institutionId == null || s.institutionId == institutionId,
        )
        .toList();
    final int start = (page - 1) * pageSize;
    if (start >= scoped.length) return const <Student>[];
    final int end = (start + pageSize).clamp(0, scoped.length);
    return scoped.sublist(start, end);
  }
}

Student fakeStudent(
  int i, {
  String institutionId = 'inst-1',
  String? className,
}) {
  return Student(
    id: 'stu-$i',
    firstName: 'Student',
    lastName: i.toString().padLeft(3, '0'),
    institutionId: institutionId,
    className: className,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  );
}
