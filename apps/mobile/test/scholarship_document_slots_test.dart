import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/features/scholarship/data/scholarship_document_rules.dart';
import 'package:proctira_mobile/features/scholarship/data/scholarship_file_picker.dart';
import 'package:proctira_mobile/features/scholarship/data/scholarship_repository.dart';
import 'package:proctira_mobile/features/scholarship/presentation/scholarship_document_slots.dart';

class _FakePicker implements ScholarshipFilePicker {
  _FakePicker(this.next);

  PickedScholarshipFile? next;
  ScholarshipPickSource? lastSource;

  @override
  Future<PickedScholarshipFile?> pick(ScholarshipPickSource source) async {
    lastSource = source;
    return next;
  }
}

const List<int> _jpeg = <int>[0xFF, 0xD8, 0xFF, 0xD9];

void main() {
  test('document upload is offered only when the download route exists', () {
    expect(scholarshipDocumentUploadRoutePresent(401), isTrue);
    expect(scholarshipDocumentUploadRoutePresent(400), isTrue);
    expect(scholarshipDocumentUploadRoutePresent(200), isTrue);
    expect(scholarshipDocumentUploadRoutePresent(404), isFalse);
    expect(scholarshipDocumentUploadRoutePresent(502), isFalse);
    expect(scholarshipDocumentUploadRoutePresent(null), isFalse);
  });

  test('program JSON exposes required document types', () {
    final ScholarshipProgram program = ScholarshipProgram.fromJson(
      <String, dynamic>{
        'id': 'p1',
        'name': 'Merit',
        'description': 'Award',
        'provider': 'Board',
        'eligibility': <String, dynamic>{
          'requiredDocuments': <String>['marksheet', 'id_proof'],
        },
      },
    );
    expect(program.requiredDocuments, <String>['marksheet', 'id_proof']);
  });

  test('client rejects the wrong type, empty files, and files over 10 MB', () {
    expect(
      scholarshipDocumentClientError(
        mimeType: 'text/plain',
        sizeBytes: 12,
      ),
      'Use a PDF, JPEG, or PNG.',
    );
    expect(
      scholarshipDocumentClientError(
        mimeType: 'image/jpeg',
        sizeBytes: 0,
      ),
      'That file is empty.',
    );
    expect(
      scholarshipDocumentClientError(
        mimeType: 'application/pdf',
        sizeBytes: scholarshipDocumentMaxBytes + 1,
      ),
      'File must be 10 MB or smaller.',
    );
    expect(
      scholarshipDocumentClientError(
        mimeType: 'image/png',
        sizeBytes: 32,
      ),
      isNull,
    );
  });

  test('missing required types ignore ones already uploaded', () {
    expect(
      missingRequiredScholarshipDocuments(
        <String>['income_certificate', 'marksheet'],
        <String>['income_certificate'],
      ),
      <String>['marksheet'],
    );
  });

  testWidgets('slots expose a control for every required type', (
    WidgetTester tester,
  ) async {
    final ScholarshipDocumentUploadController controller =
        ScholarshipDocumentUploadController(
      requiredTypes: const <String>['income_certificate', 'id_proof'],
      picker: _FakePicker(null),
      upload: (String type, PickedScholarshipFile file, void Function(double) onProgress) async {},
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ScholarshipDocumentUploadPanel(controller: controller),
        ),
      ),
    );

    expect(find.text('Income certificate'), findsOneWidget);
    expect(find.text('ID proof'), findsOneWidget);
    expect(
      find.bySemanticsLabel('Choose a photo for Income certificate'),
      findsOneWidget,
    );
    expect(
      find.bySemanticsLabel('Take a photo for ID proof'),
      findsOneWidget,
    );
    expect(
      find.bySemanticsLabel('Choose a PDF or image for Income certificate'),
      findsOneWidget,
    );
    controller.dispose();
  });

  testWidgets('a rejected file type stays on the slot and is not uploaded', (
    WidgetTester tester,
  ) async {
    var uploads = 0;
    final _FakePicker picker = _FakePicker(
      const PickedScholarshipFile(
        filename: 'notes.txt',
        mimeType: 'text/plain',
        bytes: <int>[1, 2, 3],
      ),
    );
    final ScholarshipDocumentUploadController controller =
        ScholarshipDocumentUploadController(
      requiredTypes: const <String>['marksheet'],
      picker: picker,
      upload: (String type, PickedScholarshipFile file, void Function(double) onProgress) async {
        uploads += 1;
      },
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ScholarshipDocumentUploadPanel(controller: controller),
        ),
      ),
    );

    await tester.tap(find.bySemanticsLabel('Choose a PDF or image for Marksheet'));
    await tester.pumpAndSettle();

    expect(picker.lastSource, ScholarshipPickSource.file);
    expect(uploads, 0);
    expect(find.text('Use a PDF, JPEG, or PNG.'), findsOneWidget);
    expect(controller.missingTypes, <String>['marksheet']);
    controller.dispose();
  });

  testWidgets('upload shows progress and then the uploaded state', (
    WidgetTester tester,
  ) async {
    final Completer<void> gate = Completer<void>();
    final ScholarshipDocumentUploadController controller =
        ScholarshipDocumentUploadController(
      requiredTypes: const <String>['income_certificate'],
      picker: _FakePicker(
        const PickedScholarshipFile(
          filename: 'income.jpg',
          mimeType: 'image/jpeg',
          bytes: _jpeg,
        ),
      ),
      upload: (String type, PickedScholarshipFile file, void Function(double progress) onProgress) async {
        onProgress(0.4);
        await gate.future;
      },
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ScholarshipDocumentUploadPanel(controller: controller),
        ),
      ),
    );

    await tester.tap(
      find.bySemanticsLabel('Choose a photo for Income certificate'),
    );
    await tester.pump();
    await tester.pump();

    expect(find.text('Uploading income.jpg…'), findsOneWidget);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(
      find.bySemanticsLabel('Uploading Income certificate, 40 percent'),
      findsOneWidget,
    );

    gate.complete();
    await tester.pumpAndSettle();

    expect(find.text('Uploaded income.jpg'), findsOneWidget);
    expect(controller.missingTypes, isEmpty);
    controller.dispose();
  });

  testWidgets('a failed upload is announced on the slot', (
    WidgetTester tester,
  ) async {
    final ScholarshipDocumentUploadController controller =
        ScholarshipDocumentUploadController(
      requiredTypes: const <String>['id_proof'],
      picker: _FakePicker(
        const PickedScholarshipFile(
          filename: 'id.png',
          mimeType: 'image/png',
          bytes: <int>[1, 2, 3, 4],
        ),
      ),
      upload: (String type, PickedScholarshipFile file, void Function(double) onProgress) async {
        throw StateError('Documents can only be uploaded before the application is submitted');
      },
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ScholarshipDocumentUploadPanel(controller: controller),
        ),
      ),
    );

    await tester.tap(find.bySemanticsLabel('Take a photo for ID proof'));
    await tester.pumpAndSettle();

    expect(
      find.text(
        'Documents can only be uploaded before the application is submitted',
      ),
      findsOneWidget,
    );
    expect(controller.hasSlotErrors, isTrue);
    controller.dispose();
  });
}
