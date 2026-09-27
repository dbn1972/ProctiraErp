import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/features/parent_portal/data/parent_portal_models.dart';
import 'package:proctira_mobile/features/parent_portal/data/parent_portal_repository.dart';
import 'package:proctira_mobile/features/parent_portal/presentation/parent_consents_screen.dart';
import 'package:proctira_mobile/features/parent_portal/presentation/parent_fees_screen.dart';
import 'package:proctira_mobile/features/parent_portal/presentation/parent_home_screen.dart';
import 'package:proctira_mobile/features/parent_portal/presentation/parent_messages_screen.dart';

class _FakeParentPortal implements ParentPortalRepository {
  _FakeParentPortal({
    this.children = const <LinkedChild>[],
    this.error,
    this.threads = const <ParentMessageThread>[],
    this.consents = const <ParentConsent>[],
    this.invoices = const <ParentInvoice>[],
    this.gate,
  });

  List<LinkedChild> children;
  Object? error;
  final List<ParentMessageThread> threads;
  final List<ParentConsent> consents;
  final List<ParentInvoice> invoices;
  final Completer<List<LinkedChild>>? gate;
  int childCalls = 0;

  @override
  Future<List<LinkedChild>> listChildren() {
    childCalls += 1;
    final Completer<List<LinkedChild>>? pending = gate;
    if (pending != null) {
      return pending.future;
    }
    if (error != null) {
      return Future<List<LinkedChild>>.error(error!);
    }
    return Future<List<LinkedChild>>.value(children);
  }

  @override
  Future<List<ParentMessageThread>> listThreads({required String studentId}) {
    return Future<List<ParentMessageThread>>.value(
      threads
          .where((ParentMessageThread row) => row.studentId == studentId)
          .toList(growable: false),
    );
  }

  @override
  Future<List<ParentConsent>> listConsents({required String studentId}) {
    return Future<List<ParentConsent>>.value(
      consents
          .where((ParentConsent row) => row.studentId == studentId)
          .toList(growable: false),
    );
  }

  @override
  Future<List<ParentInvoice>> listInvoices({required String studentId}) {
    return Future<List<ParentInvoice>>.value(
      invoices
          .where((ParentInvoice row) => row.studentId == studentId)
          .toList(growable: false),
    );
  }
}

const LinkedChild _amina = LinkedChild(
  linkId: 'link-1',
  studentId: 'stu-1',
  relationship: 'mother',
  status: 'active',
  givenName: 'Amina Hassan',
  className: 'Grade 4',
);

const LinkedChild _bilal = LinkedChild(
  linkId: 'link-2',
  studentId: 'stu-2',
  relationship: 'father',
  status: 'active',
  givenName: 'Bilal Khan',
  className: 'Class 6B',
);

Future<void> _pump(WidgetTester tester, Widget home) async {
  await tester.pumpWidget(MaterialApp(home: home));
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets('parent home shows a loading state', (WidgetTester tester) async {
    final Completer<List<LinkedChild>> gate = Completer<List<LinkedChild>>();
    await tester.pumpWidget(
      MaterialApp(
        home: ParentHomeScreen(
          repository: _FakeParentPortal(gate: gate),
        ),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.bySemanticsLabel('Loading linked children'), findsOneWidget);
    gate.complete(const <LinkedChild>[]);
    await tester.pump();
    await tester.pump();
  });

  testWidgets('parent home shows an empty state', (WidgetTester tester) async {
    await _pump(
      tester,
      ParentHomeScreen(repository: _FakeParentPortal()),
    );

    expect(find.text('No children linked yet'), findsOneWidget);
    expect(find.text('Messages'), findsNothing);
  });

  testWidgets('parent home lists children and selects one', (WidgetTester tester) async {
    await _pump(
      tester,
      ParentHomeScreen(
        repository: _FakeParentPortal(children: <LinkedChild>[_amina, _bilal]),
      ),
    );

    expect(find.text('Amina Hassan'), findsOneWidget);
    expect(find.text('Grade 4'), findsOneWidget);
    expect(find.text('Bilal Khan'), findsOneWidget);
    expect(find.text('Class 6B'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey<String>('child-stu-1')),
        matching: find.byKey(const Key('selected-child')),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('Amina Hassan, class Grade 4'), findsOneWidget);

    await tester.tap(find.text('Bilal Khan'));
    await tester.pump();

    expect(
      find.descendant(
        of: find.byKey(const ValueKey<String>('child-stu-2')),
        matching: find.byKey(const Key('selected-child')),
      ),
      findsOneWidget,
    );
    expect(find.text('Messages'), findsOneWidget);
    expect(find.text('Consents'), findsOneWidget);
    expect(find.text('Fees'), findsOneWidget);
  });

  testWidgets('parent home shows an error and retries', (WidgetTester tester) async {
    final _FakeParentPortal repo = _FakeParentPortal(
      error: const ParentPortalException('Parent portal failed'),
    );
    await _pump(tester, ParentHomeScreen(repository: repo));

    expect(find.text('Parent portal failed'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    expect(tester.getSize(find.widgetWithText(FilledButton, 'Retry')).height,
        greaterThanOrEqualTo(44));

    repo.error = null;
    repo.children = const <LinkedChild>[_amina];
    await tester.tap(find.text('Retry'));
    await tester.pump();
    await tester.pump();

    expect(find.text('Amina Hassan'), findsOneWidget);
    expect(repo.childCalls, 2);
  });

  testWidgets('messages, consents, and fees use the selected child', (
    WidgetTester tester,
  ) async {
    final _FakeParentPortal repo = _FakeParentPortal(
      threads: const <ParentMessageThread>[
        ParentMessageThread(
          id: 't-1',
          studentId: 'stu-1',
          subject: 'School trip',
          status: 'open',
        ),
        ParentMessageThread(
          id: 't-2',
          studentId: 'stu-2',
          subject: 'Hidden thread',
          status: 'open',
        ),
      ],
      consents: const <ParentConsent>[
        ParentConsent(
          id: 'c-1',
          studentId: 'stu-1',
          title: 'Photo day',
          status: 'pending',
          consentType: 'photo',
        ),
      ],
      invoices: const <ParentInvoice>[
        ParentInvoice(
          id: 'i-1',
          studentId: 'stu-1',
          title: 'Term fees',
          status: 'issued',
          amountCents: 250000,
          currency: 'KES',
        ),
      ],
    );

    await _pump(
      tester,
      ParentMessagesScreen(studentId: 'stu-1', repository: repo),
    );
    expect(find.text('School trip'), findsOneWidget);
    expect(find.text('Hidden thread'), findsNothing);

    await _pump(
      tester,
      ParentConsentsScreen(studentId: 'stu-1', repository: repo),
    );
    expect(find.text('Photo day'), findsOneWidget);

    await _pump(
      tester,
      ParentFeesScreen(studentId: 'stu-1', repository: repo),
    );
    expect(find.text('Term fees'), findsOneWidget);
    expect(find.textContaining('KES 2500.00'), findsOneWidget);
  });

  testWidgets('child screens stay empty without a selected child', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(home: ParentMessagesScreen()),
    );
    await tester.pump();

    expect(
      find.text('Select a child on the parent home screen.'),
      findsOneWidget,
    );
  });
}
