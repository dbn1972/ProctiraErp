import 'package:flutter/material.dart';

import '../data/parent_portal_models.dart';
import '../data/parent_portal_repository.dart';
import 'parent_resource_screen.dart';

/// Parent message threads for the selected child.
class ParentMessagesScreen extends StatelessWidget {
  const ParentMessagesScreen({super.key, this.studentId, this.repository});

  final String? studentId;
  final ParentPortalRepository? repository;

  @override
  Widget build(BuildContext context) {
    return ParentResourceScreen(
      title: 'Messages',
      studentId: studentId,
      repository: repository,
      emptyMessage: 'No messages for this child yet.',
      load: (ParentPortalRepository repo, String id) async {
        final List<ParentMessageThread> threads =
            await repo.listThreads(studentId: id);
        return threads
            .map(
              (ParentMessageThread thread) => ParentPortalRow(
                title: thread.subject,
                subtitle: _label(thread.status),
              ),
            )
            .toList(growable: false);
      },
    );
  }
}

String _label(String raw) {
  final String text = raw.trim();
  if (text.isEmpty) {
    return 'Open';
  }
  final String spaced = text.replaceAll('_', ' ');
  return spaced[0].toUpperCase() + spaced.substring(1);
}
