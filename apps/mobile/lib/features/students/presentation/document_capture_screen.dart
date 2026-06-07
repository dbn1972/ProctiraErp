import 'dart:io';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:openemis_api_client/openemis_api_client.dart';

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
    final XFile? picked = _picked;
    return Scaffold(
      appBar: AppBar(title: const Text('Capture document')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(
                'Student: ${widget.studentId}',
                style: theme.textTheme.bodyMedium,
              ),
              const SizedBox(height: 16),
              Expanded(
                child: Center(
                  child: picked == null
                      ? Column(
                          mainAxisSize: MainAxisSize.min,
                          children: <Widget>[
                            const Icon(Icons.photo_camera_outlined, size: 64),
                            const SizedBox(height: 16),
                            Text(
                              'No document selected.',
                              style: theme.textTheme.bodyMedium,
                            ),
                          ],
                        )
                      : ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.file(
                            File(picked.path),
                            fit: BoxFit.contain,
                          ),
                        ),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: <Widget>[
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _capture(ImageSource.camera),
                      icon: const Icon(Icons.camera_alt_outlined),
                      label: const Text('Camera'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _capture(ImageSource.gallery),
                      icon: const Icon(Icons.photo_library_outlined),
                      label: const Text('Gallery'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: picked == null || _saving ? null : _save,
                child: Text(_saving ? 'Saving…' : 'Queue for sync'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
