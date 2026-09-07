import 'package:flutter/material.dart';

/// Parent fee invoices shell with sandbox pay path on the API.
class ParentFeesScreen extends StatelessWidget {
  const ParentFeesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Fees')),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'View open invoices and pay via sandbox '
            '`POST /parent-portal/fees/invoices/:id/pay`.',
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
