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
            'Fee invoices are not available in this app build yet. '
            'Use the parent web portal to view and pay invoices.',
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
