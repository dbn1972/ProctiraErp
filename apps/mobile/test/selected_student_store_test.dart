import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/student/selected_student_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  test('select persists the student and clear removes it', () async {
    final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
    final SelectedStudentStore store = SelectedStudentStore(secure);

    await store.select(id: 'stu-1', displayName: 'Ada Lovelace');
    expect(store.studentId, 'stu-1');
    expect(store.displayName, 'Ada Lovelace');
    expect(await secure.readSelectedStudentId(), 'stu-1');
    expect(await secure.readSelectedStudentName(), 'Ada Lovelace');

    await store.select(id: 'stu-2');
    expect(store.studentId, 'stu-2');
    expect(store.displayName, isNull);

    await store.clear();
    expect(store.hasStudent, isFalse);
    expect(await secure.readSelectedStudentId(), isNull);
  });

  test('bootstrap restores a stored student', () async {
    final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
    await secure.writeSelectedStudent(id: 'stu-9', displayName: 'Grace');
    final SelectedStudentStore store = SelectedStudentStore(secure);
    await store.bootstrap();
    expect(store.studentId, 'stu-9');
    expect(store.displayName, 'Grace');
  });
}
