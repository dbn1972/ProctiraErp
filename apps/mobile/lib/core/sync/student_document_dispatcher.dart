import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:path/path.dart' as p;
import 'package:proctira_api_client/proctira_api_client.dart';

import 'sync_dispatcher.dart';
import 'sync_models.dart';

/// `pending_sync.payload['kind']` for a queued student document upload.
const String kStudentDocumentKind = 'student_document';

/// Backend limit: `contentBase64` maxLength 14,000,000 chars
/// (packages/backend/student/src/students-360/schemas.ts) ≈ 10.5 MB raw.
const int kMaxStudentDocumentBytes = 10 * 1024 * 1024;

/// Document categories accepted by `UploadDocumentSchema`.
const List<String> kStudentDocumentCategories = <String>[
  'birth_certificate',
  'transfer_certificate',
  'passport',
  'national_id',
  'medical',
  'address_proof',
  'previous_marksheet',
  'other',
];

/// MIME type accepted by the backend for [path], by extension. Camera
/// captures from `image_picker` are JPEG.
String documentMimeType(String path) {
  switch (p.extension(path).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'image/jpeg';
  }
}

Future<Uint8List?> _defaultReadFile(String path) async {
  final File file = File(path);
  if (!await file.exists()) return null;
  return file.readAsBytes();
}

Future<void> _defaultDeleteFile(String path) async {
  final File file = File(path);
  if (await file.exists()) await file.delete();
}

/// Uploads queued student documents (PRC-H016) to
/// `POST /api/v1/students/:id/documents` as `{category, fileName, mimeType,
/// contentBase64}` with the queue row's idempotency key. Other student ops
/// are not synced from mobile and are parked with an explicit reason.
class StudentDocumentSyncDispatcher implements SyncDispatcher {
  StudentDocumentSyncDispatcher(
    this.api, {
    Future<Uint8List?> Function(String path) readFile = _defaultReadFile,
    Future<void> Function(String path) deleteFile = _defaultDeleteFile,
  }) : _readFile = readFile,
       _deleteFile = deleteFile;

  final StudentApi api;
  final Future<Uint8List?> Function(String path) _readFile;
  final Future<void> Function(String path) _deleteFile;

  static const String _basePath = '/api/v1/students';

  @override
  Future<DispatchOutcome> dispatch(PendingSyncRow row) async {
    final Map<String, dynamic> payload = row.payload;
    if (row.entityType != SyncEntityType.student ||
        row.operation != SyncOperation.create ||
        payload['kind'] != kStudentDocumentKind) {
      return const DispatchPermanent(
        'Student profile changes are not synced from the mobile app',
      );
    }
    final String? studentId = payload['studentId'] as String?;
    final String? filePath = payload['filePath'] as String?;
    if (studentId == null || filePath == null) {
      return const DispatchPermanent('Document upload is missing its file');
    }
    final Uint8List? bytes;
    try {
      bytes = await _readFile(filePath);
    } catch (error) {
      return DispatchPermanent('Could not read the captured file: $error');
    }
    if (bytes == null) {
      return const DispatchPermanent(
        'The captured file is no longer on this device',
      );
    }
    if (bytes.length > kMaxStudentDocumentBytes) {
      return const DispatchPermanent('Document is larger than 10 MB');
    }
    final String category = payload['category'] as String? ?? 'other';
    try {
      final Response<dynamic> response = await api.request<dynamic>(
        '$_basePath/$studentId/documents',
        method: 'POST',
        data: <String, dynamic>{
          'category': kStudentDocumentCategories.contains(category)
              ? category
              : 'other',
          'fileName': payload['fileName'] as String? ?? p.basename(filePath),
          'mimeType':
              payload['mimeType'] as String? ?? documentMimeType(filePath),
          'contentBase64': base64Encode(bytes),
        },
        idempotencyKey: row.idempotencyKey,
      );
      // The server now holds the bytes; drop the on-device copy of the
      // child's document (best effort).
      try {
        await _deleteFile(filePath);
      } catch (_) {}
      final Object? body = response.data;
      final Map<String, dynamic> entity = body is Map<String, dynamic>
          ? (body['data'] is Map<String, dynamic>
                ? body['data'] as Map<String, dynamic>
                : body)
          : const <String, dynamic>{};
      // Empty version: nothing in the local cache is versioned by this op.
      return DispatchSuccess(serverEntity: entity, serverVersion: '');
    } on ConflictException catch (error) {
      return DispatchPermanent(error.message);
    } on PermanentApiException catch (error) {
      return DispatchPermanent(error.message);
    } on TransientApiException catch (error) {
      return DispatchTransient(error.message);
    } catch (error) {
      return DispatchTransient(error.toString());
    }
  }
}
