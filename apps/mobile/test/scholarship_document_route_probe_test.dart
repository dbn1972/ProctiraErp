import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/features/scholarship/data/scholarship_document_rules.dart';

/// PRC-L212: a document-route probe must not fail open. Only a definitive 404
/// drops the required-document gate; a transient network error (null) or a 5xx
/// is `unknown` and must keep the gate (fail closed).
void main() {
  group('PRC-L212 scholarship document route probe', () {
    test('definitive responses classify present', () {
      expect(
        scholarshipDocumentRouteState(200),
        ScholarshipDocumentRouteState.present,
      );
      expect(
        scholarshipDocumentRouteState(401),
        ScholarshipDocumentRouteState.present,
      );
      expect(
        scholarshipDocumentRouteState(400),
        ScholarshipDocumentRouteState.present,
      );
    });

    test('404 classifies absent', () {
      expect(
        scholarshipDocumentRouteState(404),
        ScholarshipDocumentRouteState.absent,
      );
    });

    test('network error (null) and 5xx classify unknown (fail closed)', () {
      expect(
        scholarshipDocumentRouteState(null),
        ScholarshipDocumentRouteState.unknown,
      );
      expect(
        scholarshipDocumentRouteState(500),
        ScholarshipDocumentRouteState.unknown,
      );
      expect(
        scholarshipDocumentRouteState(503),
        ScholarshipDocumentRouteState.unknown,
      );
    });

    test('unknown is NOT treated as present by the back-compat boolean', () {
      // The old boolean returned false for null/5xx, which the screen used to
      // bypass the gate. The gate decision now keys off absent only, so a
      // transient error keeps the gate on.
      expect(scholarshipDocumentUploadRoutePresent(null), isFalse);
      expect(scholarshipDocumentUploadRoutePresent(503), isFalse);
      // and the tri-state proves these are "unknown", not "absent":
      expect(
        scholarshipDocumentRouteState(null),
        isNot(ScholarshipDocumentRouteState.absent),
      );
      expect(
        scholarshipDocumentRouteState(503),
        isNot(ScholarshipDocumentRouteState.absent),
      );
    });
  });
}
