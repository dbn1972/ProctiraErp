import 'package:flutter/material.dart';

/// Parent messaging list shell — wired to `/api/v1/parent-portal` in follow-up.
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
            'Open message threads with the school from the parent portal API '
            '(`/parent-portal/messages/threads`).',
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
