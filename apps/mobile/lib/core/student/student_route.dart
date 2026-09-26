/// Appends `studentId` when the path does not already name a student.
String withStudentQuery(String path, String? studentId) {
  final String id = studentId?.trim() ?? '';
  if (id.isEmpty) {
    return path;
  }
  final Uri uri = Uri.parse(path);
  if ((uri.queryParameters['studentId'] ?? '').trim().isNotEmpty) {
    return path;
  }
  return uri
      .replace(
        queryParameters: <String, String>{
          ...uri.queryParameters,
          'studentId': id,
        },
      )
      .toString();
}
