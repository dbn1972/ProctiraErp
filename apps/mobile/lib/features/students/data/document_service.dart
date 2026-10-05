import 'dart:io';

import '../../../core/storage/captured_document_store.dart';
import '../../../core/sync/student_document_dispatcher.dart';
import '../data/student_repository.dart';

/// Outcome of capturing or selecting a document and persisting it locally.
class DocumentUploadResult {
  const DocumentUploadResult({
    required this.studentId,
    required this.filePath,
    required this.queued,
    this.rejectedReason,
  });

  final String studentId;
  final String filePath;

  /// Whether the document was queued for upload. False when the student id
  /// could not be located in the cache or the file was rejected.
  final bool queued;

  /// Set when the file was rejected before queueing (e.g. too large).
  final String? rejectedReason;
}

/// Records a captured document against a student and queues its upload
/// (PRC-H016).
///
/// The picked file is sealed into the app-private encrypted
/// [CapturedDocumentStore] and the plaintext picker temp file deleted
/// (PRC-M046); the sealed copy is uploaded by [StudentDocumentSyncDispatcher]
/// and deleted after the server accepts it.
class DocumentService {
  DocumentService(this._repository, {required CapturedDocumentStore store})
    : _store = store;

  final StudentRepository _repository;
  final CapturedDocumentStore _store;

  Future<DocumentUploadResult> uploadCapturedDocument({
    required String studentId,
    required String filePath,
    String category = 'other',
  }) async {
    final File source = File(filePath);
    final int size = await source.length();
    if (size > kMaxStudentDocumentBytes) {
      await _store.discard(filePath);
      return DocumentUploadResult(
        studentId: studentId,
        filePath: filePath,
        queued: false,
        rejectedReason: 'Document is larger than 10 MB',
      );
    }
    final String durablePath = await _store.seal(source);

    final CachedStudent? saved = await _repository.attachDocument(
      studentId: studentId,
      filePath: durablePath,
      category: category,
    );
    if (saved == null) {
      // Nothing queued; don't leave an orphaned copy of the child's document.
      await _store.discard(durablePath);
    }
    return DocumentUploadResult(
      studentId: studentId,
      filePath: durablePath,
      queued: saved != null,
    );
  }
}
