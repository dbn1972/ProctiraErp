// Client checks for scholarship supporting documents. The API re-checks bytes.

const int scholarshipDocumentMaxBytes = 10 * 1024 * 1024;

const Set<String> scholarshipDocumentMimes = <String>{
  'application/pdf',
  'image/jpeg',
  'image/png',
};

const List<String> defaultScholarshipDocumentTypes = <String>[
  'income_certificate',
  'marksheet',
  'id_proof',
];

const Map<String, String> scholarshipDocumentTypeLabels = <String, String>{
  'income_certificate': 'Income certificate',
  'marksheet': 'Marksheet',
  'caste_certificate': 'Caste certificate',
  'category_certificate': 'Category certificate',
  'id_proof': 'ID proof',
  'transcript': 'Transcript',
  'national_id': 'National ID',
  'recommendation_letter': 'Recommendation letter',
  'other': 'Other supporting document',
};

String scholarshipDocumentTypeLabel(String type) {
  return scholarshipDocumentTypeLabels[type] ?? type.replaceAll('_', ' ');
}

String mimeTypeForFilename(String filename) {
  final String lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) {
    return 'application/pdf';
  }
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  return 'application/octet-stream';
}

/// Null when the file may be uploaded. The message is safe to show in the slot.
String? scholarshipDocumentClientError({
  required String mimeType,
  required int sizeBytes,
}) {
  if (!scholarshipDocumentMimes.contains(mimeType)) {
    return 'Use a PDF, JPEG, or PNG.';
  }
  if (sizeBytes <= 0) {
    return 'That file is empty.';
  }
  if (sizeBytes > scholarshipDocumentMaxBytes) {
    return 'File must be 10 MB or smaller.';
  }
  return null;
}

/// Required types that are not in [uploadedTypes].
List<String> missingRequiredScholarshipDocuments(
  List<String> required,
  Iterable<String> uploadedTypes,
) {
  final Set<String> have = uploadedTypes.toSet();
  return required
      .where((String type) => !have.contains(type))
      .toList(growable: false);
}

/// Short message from a failed upload. Does not include file bytes.
String scholarshipUploadErrorMessage(Object error) {
  final String raw = error.toString();
  final RegExp message = RegExp(r'"message"\s*:\s*"([^"]+)"');
  final RegExpMatch? match = message.firstMatch(raw);
  if (match != null) {
    return match.group(1) ?? 'Upload failed. Try that file again.';
  }
  if (raw.contains('DioException') || raw.contains('SocketException')) {
    return 'Upload failed. Check your connection and try again.';
  }
  if (error is StateError && error.message.isNotEmpty) {
    return error.message;
  }
  return 'Upload failed. Try that file again.';
}

class PickedScholarshipFile {
  const PickedScholarshipFile({
    required this.filename,
    required this.mimeType,
    required this.bytes,
  });

  final String filename;
  final String mimeType;
  final List<int> bytes;
}
