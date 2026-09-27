import 'package:flutter/material.dart';

import '../data/parent_portal_models.dart';
import '../data/parent_portal_repository.dart';
import 'parent_resource_screen.dart';

/// Parent fee invoices for the selected child.
class ParentFeesScreen extends StatelessWidget {
  const ParentFeesScreen({super.key, this.studentId, this.repository});

  final String? studentId;
  final ParentPortalRepository? repository;

  @override
  Widget build(BuildContext context) {
    return ParentResourceScreen(
      title: 'Fees',
      studentId: studentId,
      repository: repository,
      emptyMessage: 'No fee invoices for this child.',
      load: (ParentPortalRepository repo, String id) async {
        final List<ParentInvoice> invoices =
            await repo.listInvoices(studentId: id);
        return invoices
            .map(
              (ParentInvoice invoice) => ParentPortalRow(
                title: invoice.title,
                subtitle: '${invoice.amountLabel} · ${_status(invoice.status)}',
              ),
            )
            .toList(growable: false);
      },
    );
  }
}

String _status(String raw) {
  final String text = raw.trim();
  if (text.isEmpty) {
    return 'Open';
  }
  final String spaced = text.replaceAll('_', ' ');
  return spaced[0].toUpperCase() + spaced.substring(1);
}
