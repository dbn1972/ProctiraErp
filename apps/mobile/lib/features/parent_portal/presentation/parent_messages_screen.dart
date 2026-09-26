import 'package:flutter/material.dart';

/// Parent messaging list shell — threads API not wired on mobile yet.
class ParentMessagesScreen extends StatelessWidget {
  const ParentMessagesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Messages')),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'School message threads are not available in this app build yet. '
            'Use the parent web portal to read and send messages.',
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
