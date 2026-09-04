import 'dart:io';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:proctira_api_client/proctira_api_client.dart';

import '../../../core/di/injector.dart';
import '../../../core/storage/database.dart';
import '../../../core/sync/sync_engine.dart';
import '../../../core/tenant/tenant_provider.dart';
import '../data/document_service.dart';
import '../data/student_repository.dart';

/// Screen that lets the user capture a document via camera or pick one from
/// the gallery, then queue it for sync against a student record.
class DocumentCaptureScreen extends StatefulWidget {
  const DocumentCaptureScreen({super.key, required this.studentId});

  final String studentId;

  @override
  State<DocumentCaptureScreen> createState() => _DocumentCaptureScreenState();
}

class _DocumentCaptureScreenState extends State<DocumentCaptureScreen> {
  final ImagePicker _picker = ImagePicker();
  late final StudentRepository _repository = StudentRepository(
    database: getIt<AppDatabase>(),
    tenantProvider: getIt<TenantProvider>(),
    syncEngine: getIt<SyncEngine>(),
    studentApi: getIt<StudentApi>(),
  );
  late final DocumentService _service = DocumentService(_repository);

  XFile? _picked;
  bool _saving = false;

  Future<void> _capture(ImageSource source) async {
    try {
      final XFile? file = await _picker.pickImage(
        source: source,
        imageQuality: 80,
      );
      if (file == null || !mounted) return;
      setState(() => _picked = file);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Capture failed: $error')),
      );
    }
  }

  Future<void> _save() async {
    final XFile? picked = _picked;
    if (picked == null) return;
    setState(() => _saving = true);
    try {
      final DocumentUploadResult result = await _service.uploadCapturedDocument(
        studentId: widget.studentId,
        filePath: picked.path,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            result.queued
                ? 'Document queued for sync'
                : 'Student not in cache; document not queued',
          ),
        ),
      );
      if (result.queued && context.canPop()) {
        context.pop();
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to queue document: $error')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme cs = theme.colorScheme;
    final XFile? picked = _picked;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Scan document'),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: <Widget>[
            Text(
              'Student: ${widget.studentId}',
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: cs.onSurfaceVariant),
            ),
            const SizedBox(height: 16),
            // Viewfinder / preview card.
            AspectRatio(
              aspectRatio: 3 / 3.6,
              child: picked == null
                  ? _Viewfinder()
                  : ClipRRect(
                      borderRadius: BorderRadius.circular(22),
                      child: Stack(
                        fit: StackFit.expand,
                        children: <Widget>[
                          Image.file(File(picked.path), fit: BoxFit.cover),
                          Positioned(
                            top: 12,
                            right: 12,
                            child: Material(
                              color: Colors.black54,
                              shape: const CircleBorder(),
                              child: IconButton(
                                icon: const Icon(Icons.close,
                                    color: Colors.white, size: 20),
                                tooltip: 'Discard',
                                onPressed: _saving
                                    ? null
                                    : () => setState(() => _picked = null),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
            ),
            const SizedBox(height: 20),
            // Capture controls: gallery, shutter, (gallery alt).
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: <Widget>[
                _SideButton(
                  icon: Icons.photo_library_outlined,
                  label: 'Gallery',
                  color: const Color(0xFF14B8A6),
                  onPressed:
                      _saving ? null : () => _capture(ImageSource.gallery),
                ),
                _ShutterButton(
                  onPressed:
                      _saving ? null : () => _capture(ImageSource.camera),
                ),
                _SideButton(
                  icon: Icons.refresh,
                  label: 'Retake',
                  color: const Color(0xFF64748B),
                  onPressed: _saving || picked == null
                      ? null
                      : () => _capture(ImageSource.camera),
                ),
              ],
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: picked == null || _saving ? null : _save,
              icon: _saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.cloud_upload_outlined),
              label: Text(_saving ? 'Queuing…' : 'Queue for sync'),
            ),
            const SizedBox(height: 14),
            Text(
              'Scans are stored on device and upload automatically when you '
              'are back online.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: cs.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

/// Dark camera-style placeholder with a dashed document frame and caption,
/// shown before a document has been captured.
class _Viewfinder extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(22),
      child: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: <Color>[
              Color(0xFF1B2236),
              Color(0xFF0E1426),
              Color(0xFF0A0F21),
            ],
          ),
        ),
        child: Stack(
          alignment: Alignment.center,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.all(28),
              child: DottedBorderBox(
                color: const Color(0xFF10B981),
                child: const Center(
                  child: Icon(Icons.description_outlined,
                      size: 56, color: Colors.white24),
                ),
              ),
            ),
            const Positioned(
              left: 0,
              right: 0,
              bottom: 16,
              child: Text(
                'Align the document within the frame',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white70,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A rounded box with a dashed (custom-painted) border, used as the detected
/// document outline inside the viewfinder.
class DottedBorderBox extends StatelessWidget {
  const DottedBorderBox({super.key, required this.color, required this.child});

  final Color color;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _DashedRectPainter(color: color),
      child: child,
    );
  }
}

class _DashedRectPainter extends CustomPainter {
  _DashedRectPainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final Paint paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5
      ..strokeCap = StrokeCap.round;
    final RRect rrect = RRect.fromRectAndRadius(
      Offset.zero & size,
      const Radius.circular(8),
    );
    final Path path = Path()..addRRect(rrect);
    const double dash = 10;
    const double gap = 7;
    for (final metric in path.computeMetrics()) {
      double dist = 0;
      while (dist < metric.length) {
        canvas.drawPath(
          metric.extractPath(dist, dist + dash),
          paint,
        );
        dist += dash + gap;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DashedRectPainter oldDelegate) =>
      oldDelegate.color != color;
}

/// Round 'shutter' button that triggers a camera capture.
class _ShutterButton extends StatelessWidget {
  const _ShutterButton({required this.onPressed});

  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final ColorScheme cs = Theme.of(context).colorScheme;
    final bool enabled = onPressed != null;
    return GestureDetector(
      onTap: onPressed,
      child: Container(
        width: 74,
        height: 74,
        decoration: BoxDecoration(
          color: enabled ? cs.primary : cs.onSurface.withValues(alpha: 0.12),
          shape: BoxShape.circle,
          border: Border.all(
            color: cs.primary.withValues(alpha: enabled ? 0.35 : 0.0),
            width: 4,
          ),
          boxShadow: enabled
              ? <BoxShadow>[
                  BoxShadow(
                    color: cs.primary.withValues(alpha: 0.4),
                    blurRadius: 22,
                    offset: const Offset(0, 10),
                  ),
                ]
              : null,
        ),
        child: Icon(
          Icons.camera_alt_outlined,
          color: enabled ? cs.onPrimary : cs.onSurfaceVariant,
          size: 28,
        ),
      ),
    );
  }
}

/// Square secondary capture-control button with a label below.
class _SideButton extends StatelessWidget {
  const _SideButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final bool enabled = onPressed != null;
    final Color tint = enabled ? color : theme.colorScheme.onSurfaceVariant;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onPressed,
          child: Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: tint.withValues(alpha: enabled ? 0.12 : 0.06),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: theme.dividerColor),
            ),
            child: Icon(icon, color: tint, size: 22),
          ),
        ),
        const SizedBox(height: 6),
        Text(
          label,
          style: theme.textTheme.labelSmall
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
      ],
    );
  }
}
