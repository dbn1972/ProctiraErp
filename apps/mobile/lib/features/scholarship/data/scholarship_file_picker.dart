import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:image_picker/image_picker.dart';

import 'scholarship_document_rules.dart';

enum ScholarshipPickSource { gallery, camera, file }

abstract class ScholarshipFilePicker {
  Future<PickedScholarshipFile?> pick(ScholarshipPickSource source);
}

/// Camera and gallery via [ImagePicker]; PDF, JPEG, and PNG files via [FilePicker].
class DeviceScholarshipFilePicker implements ScholarshipFilePicker {
  DeviceScholarshipFilePicker({ImagePicker? images})
      : _images = images ?? ImagePicker();

  final ImagePicker _images;

  @override
  Future<PickedScholarshipFile?> pick(ScholarshipPickSource source) async {
    switch (source) {
      case ScholarshipPickSource.gallery:
        return _fromXFile(
          await _images.pickImage(
            source: ImageSource.gallery,
            imageQuality: 85,
          ),
        );
      case ScholarshipPickSource.camera:
        return _fromXFile(
          await _images.pickImage(
            source: ImageSource.camera,
            imageQuality: 85,
          ),
        );
      case ScholarshipPickSource.file:
        final List<PlatformFile> files = await FilePicker.pickFiles(
          type: FileType.custom,
          allowedExtensions: <String>['pdf', 'jpg', 'jpeg', 'png'],
        );
        if (files.isEmpty) {
          return null;
        }
        final PlatformFile file = files.single;
        final List<int> bytes = await file.readAsBytes();
        // Bytes are in memory; drop the plugin's cached copy (PRC-M046).
        try {
          await FilePicker.clearTemporaryFiles();
        } catch (_) {}
        return PickedScholarshipFile(
          filename: file.name,
          mimeType: mimeTypeForFilename(file.name),
          bytes: bytes,
        );
    }
  }

  Future<PickedScholarshipFile?> _fromXFile(XFile? file) async {
    if (file == null) {
      return null;
    }
    final List<int> bytes = await file.readAsBytes();
    // image_picker hands back a temp copy; delete it so the plaintext scan
    // does not linger in app cache (PRC-M046).
    try {
      await File(file.path).delete();
    } catch (_) {}
    final String name = file.name.trim().isEmpty ? 'document.jpg' : file.name;
    return PickedScholarshipFile(
      filename: name,
      mimeType: mimeTypeForFilename(name),
      bytes: bytes,
    );
  }
}
