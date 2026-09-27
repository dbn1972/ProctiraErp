import 'package:flutter/material.dart';

import '../data/parent_portal_models.dart';
import '../data/parent_portal_repository.dart';
import 'parent_resource_screen.dart';

/// Parent consent requests for the selected child.
class ParentConsentsScreen extends StatelessWidget {
  const ParentConsentsScreen({super.key, this.studentId, this.repository});

  final String? studentId;
  final ParentPortalRepository? repository;

  @override
  Widget build(BuildContext context) {
    return ParentResourceScreen(
      title: 'Consents',
      studentId: studentId,
      repository: repository,
      emptyMessage: 'No consent requests for this child.',
      load: (ParentPortalRepository repo, String id) async {
        final List<ParentConsent> consents =
            await repo.listConsents(studentId: id);
        return consents
            .map(
              (ParentConsent consent) => ParentPortalRow(
                title: consent.title,
                subtitle: _consentSubtitle(consent),
              ),
            )
            .toList(growable: false);
      },
    );
  }
}

String _consentSubtitle(ParentConsent consent) {
  final String status = consent.status.trim().isEmpty
      ? 'Pending'
      : consent.status.replaceAll('_', ' ');
  final String type = consent.consentType.trim();
  if (type.isEmpty) {
    return status[0].toUpperCase() + status.substring(1);
  }
  final String prettyStatus = status[0].toUpperCase() + status.substring(1);
  return '$prettyStatus · $type';
}
