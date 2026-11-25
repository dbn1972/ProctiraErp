import 'package:flutter/material.dart';

import '../data/parent_portal_models.dart';
import '../data/parent_portal_repository.dart';
import 'parent_resource_screen.dart';

/// Sandbox/UAT builds only (PRC-M039).
const bool kSandboxParentPayEnabled = bool.fromEnvironment(
  'PROCTIRA_SANDBOX_PARENT_PAY',
);

/// Parent fee invoices for the selected child.
///
/// PRC-M039: open invoices offer "Pay (sandbox)", which calls the parent-portal
/// pay route. The button is only built into sandbox/UAT apps
/// (`--dart-define=PROCTIRA_SANDBOX_PARENT_PAY=true`); builds without the flag
/// stay read-only until the live Razorpay checkout ships. The server still
/// decides: it refuses sandbox settlement when a verified provider is required.
class ParentFeesScreen extends StatelessWidget {
  const ParentFeesScreen({
    super.key,
    this.studentId,
    this.repository,
    this.sandboxPayEnabled = kSandboxParentPayEnabled,
  });

  final String? studentId;
  final ParentPortalRepository? repository;
  final bool sandboxPayEnabled;

  static const String sandboxPayLabel = 'Pay (sandbox)';

  bool _payable(ParentInvoice invoice) =>
      sandboxPayEnabled &&
      invoice.hasValidAmount &&
      invoice.id.isNotEmpty &&
      invoice.status.trim().toLowerCase() == 'open';

  @override
  Widget build(BuildContext context) {
    return ParentResourceScreen(
      title: 'Fees',
      studentId: studentId,
      repository: repository,
      emptyMessage: 'No fee invoices for this child.',
      load: (ParentPortalRepository repo, String id) async {
        final List<ParentInvoice> invoices = await repo.listInvoices(
          studentId: id,
        );
        return invoices
            .map(
              (ParentInvoice invoice) => ParentPortalRow(
                title: invoice.title,
                subtitle: '${invoice.amountLabel} · ${_status(invoice.status)}',
                actionLabel: _payable(invoice) ? sandboxPayLabel : null,
                onAction: _payable(invoice)
                    ? () async {
                        final ParentInvoice paid = await repo.payInvoiceSandbox(
                          invoiceId: invoice.id,
                        );
                        return 'Sandbox payment recorded: ${paid.title} is '
                            '${_status(paid.status).toLowerCase()}. '
                            'No real money moved.';
                      }
                    : null,
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
