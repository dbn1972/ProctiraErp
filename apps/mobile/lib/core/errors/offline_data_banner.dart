import 'package:flutter/material.dart';

/// Banner shown when a screen is rendering saved data because the server
/// could not be reached (PRC-M043, PRC-M562). Icon + text, never colour
/// alone, and announced to screen readers as a live region.
class OfflineDataBanner extends StatelessWidget {
  const OfflineDataBanner({
    super.key,
    this.message = "You're offline. Showing saved data.",
  });

  final String message;

  @override
  Widget build(BuildContext context) {
    final ColorScheme cs = Theme.of(context).colorScheme;
    return Semantics(
      liveRegion: true,
      container: true,
      child: Material(
        color: cs.secondaryContainer,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            children: <Widget>[
              Icon(
                Icons.cloud_off_outlined,
                size: 20,
                color: cs.onSecondaryContainer,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  message,
                  style: TextStyle(color: cs.onSecondaryContainer),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
