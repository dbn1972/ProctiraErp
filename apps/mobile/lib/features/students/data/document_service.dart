import '../data/student_repository.dart';

/// Outcome of capturing or selecting a document and persisting it locally.
class DocumentUploadResult {
  const DocumentUploadResult({
    required this.studentId,
    required this.filePath,
    required this.queued,
  });

  final String studentId;
  final String filePath;

  /// Whether the document was queued for sync. False when the student id
  /// could not be located in the cache.
  final bool queued;
}

/// Service that records a captured document against a student record.
///
/// The mobile app stores the local file path inside `students_cache.payload`
/// and queues a `student.update` op via the sync engine. A future revision
/// will translate the path into a multipart upload before replaying the op.
class DocumentService {
  DocumentService(this._repository);

  final StudentRepository _repository;

  Future<DocumentUploadResult> uploadCapturedDocument({
    required String studentId,
    required String filePath,
  }) async {
    final CachedStudent? saved = await _repository.attachDocument(
      studentId: studentId,
      filePath: filePath,
    );
    return DocumentUploadResult(
      studentId: studentId,
      filePath: filePath,
      queued: saved != null,
    );
  }
}
