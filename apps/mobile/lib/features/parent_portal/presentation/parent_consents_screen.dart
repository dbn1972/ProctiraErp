import 'package:flutter/material.dart';

/// Parent consent list shell.
class ParentConsentsScreen extends StatelessWidget {
  const ParentConsentsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Consents')),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Approve or deny photo, medical, and trip consent requests via '
            '`/parent-portal/consents`.',
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
