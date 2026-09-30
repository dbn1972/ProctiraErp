import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

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

Future<Directory> _defaultStorageDir() async => Directory(
  p.join((await getApplicationSupportDirectory()).path, 'pending_documents'),
);

/// Records a captured document against a student and queues its upload
/// (PRC-H016).
///
/// The picked file is first copied into app-private storage (camera/gallery
/// temp files can be purged by the OS before the device is back online); the
/// copy is uploaded by [StudentDocumentSyncDispatcher] and deleted after the
/// server accepts it.
class DocumentService {
  DocumentService(
    this._repository, {
    Future<Directory> Function() storageDir = _defaultStorageDir,
  }) : _storageDir = storageDir;

  final StudentRepository _repository;
  final Future<Directory> Function() _storageDir;

  Future<DocumentUploadResult> uploadCapturedDocument({
    required String studentId,
    required String filePath,
    String category = 'other',
  }) async {
    final File source = File(filePath);
    final int size = await source.length();
    if (size > kMaxStudentDocumentBytes) {
      return DocumentUploadResult(
        studentId: studentId,
        filePath: filePath,
        queued: false,
        rejectedReason: 'Document is larger than 10 MB',
      );
    }
    final Directory dir = await _storageDir();
    await dir.create(recursive: true);
    final String durablePath = p.join(
      dir.path,
      '${const Uuid().v4()}${p.extension(filePath).toLowerCase()}',
    );
    await source.copy(durablePath);

    final CachedStudent? saved = await _repository.attachDocument(
      studentId: studentId,
      filePath: durablePath,
      category: category,
    );
    if (saved == null) {
      // Nothing queued; don't leave an orphaned copy of the child's document.
      await File(durablePath).delete();
    }
    return DocumentUploadResult(
      studentId: studentId,
      filePath: durablePath,
      queued: saved != null,
    );
  }
}
