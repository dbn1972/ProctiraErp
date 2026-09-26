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
            'Consent requests are not available in this app build yet. '
            'Use the parent web portal to approve or deny photo, medical, and trip requests.',
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
