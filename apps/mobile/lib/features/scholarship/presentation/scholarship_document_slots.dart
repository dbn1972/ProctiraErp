import 'package:flutter/material.dart';

import '../data/scholarship_document_rules.dart';
import '../data/scholarship_file_picker.dart';

enum ScholarshipDocumentSlotPhase { empty, uploading, uploaded, error }

class ScholarshipDocumentSlotView {
  const ScholarshipDocumentSlotView({
    this.phase = ScholarshipDocumentSlotPhase.empty,
    this.filename,
    this.progress = 0,
    this.errorMessage,
  });

  final ScholarshipDocumentSlotPhase phase;
  final String? filename;
  final double progress;
  final String? errorMessage;

  ScholarshipDocumentSlotView copyWith({
    ScholarshipDocumentSlotPhase? phase,
    String? filename,
    double? progress,
    String? errorMessage,
    bool clearError = false,
  }) {
    return ScholarshipDocumentSlotView(
      phase: phase ?? this.phase,
      filename: filename ?? this.filename,
      progress: progress ?? this.progress,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
    );
  }
}

typedef ScholarshipDocumentUploader = Future<void> Function(
  String documentType,
  PickedScholarshipFile file,
  void Function(double progress) onProgress,
);

/// Per-type document slots. Picking validates locally, then uploads with progress.
class ScholarshipDocumentUploadController extends ChangeNotifier {
  ScholarshipDocumentUploadController({
    required List<String> requiredTypes,
    required this.picker,
    required this.upload,
  }) : requiredTypes = List<String>.unmodifiable(requiredTypes) {
    for (final String type in this.requiredTypes) {
      _slots[type] = const ScholarshipDocumentSlotView();
    }
  }

  final List<String> requiredTypes;
  final ScholarshipFilePicker picker;
  final ScholarshipDocumentUploader upload;
  final Map<String, ScholarshipDocumentSlotView> _slots =
      <String, ScholarshipDocumentSlotView>{};

  ScholarshipDocumentSlotView slot(String type) {
    return _slots[type] ?? const ScholarshipDocumentSlotView();
  }

  List<String> get uploadedTypes => requiredTypes
      .where(
        (String type) =>
            slot(type).phase == ScholarshipDocumentSlotPhase.uploaded,
      )
      .toList(growable: false);

  List<String> get missingTypes =>
      missingRequiredScholarshipDocuments(requiredTypes, uploadedTypes);

  bool get hasSlotErrors => requiredTypes.any(
        (String type) => slot(type).phase == ScholarshipDocumentSlotPhase.error,
      );

  Future<void> pickAndUpload(String type, ScholarshipPickSource source) async {
    if (slot(type).phase == ScholarshipDocumentSlotPhase.uploading) {
      return;
    }
    try {
      final PickedScholarshipFile? file = await picker.pick(source);
      if (file == null) {
        return;
      }
      final String? clientError = scholarshipDocumentClientError(
        mimeType: file.mimeType,
        sizeBytes: file.bytes.length,
      );
      if (clientError != null) {
        _slots[type] = ScholarshipDocumentSlotView(
          phase: ScholarshipDocumentSlotPhase.error,
          filename: file.filename,
          errorMessage: clientError,
        );
        notifyListeners();
        return;
      }
      _slots[type] = ScholarshipDocumentSlotView(
        phase: ScholarshipDocumentSlotPhase.uploading,
        filename: file.filename,
        progress: 0,
      );
      notifyListeners();
      await upload(type, file, (double progress) {
        _slots[type] = ScholarshipDocumentSlotView(
          phase: ScholarshipDocumentSlotPhase.uploading,
          filename: file.filename,
          progress: progress.clamp(0, 1),
        );
        notifyListeners();
      });
      _slots[type] = ScholarshipDocumentSlotView(
        phase: ScholarshipDocumentSlotPhase.uploaded,
        filename: file.filename,
        progress: 1,
      );
      notifyListeners();
    } catch (error) {
      _slots[type] = ScholarshipDocumentSlotView(
        phase: ScholarshipDocumentSlotPhase.error,
        filename: slot(type).filename,
        errorMessage: scholarshipUploadErrorMessage(error),
      );
      notifyListeners();
    }
  }
}

class ScholarshipDocumentUploadPanel extends StatelessWidget {
  const ScholarshipDocumentUploadPanel({
    super.key,
    required this.controller,
  });

  final ScholarshipDocumentUploadController controller;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (BuildContext context, Widget? child) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            for (final String type in controller.requiredTypes) ...<Widget>[
              _DocumentSlot(type: type, controller: controller),
              const SizedBox(height: 12),
            ],
          ],
        );
      },
    );
  }
}

class _DocumentSlot extends StatelessWidget {
  const _DocumentSlot({required this.type, required this.controller});

  final String type;
  final ScholarshipDocumentUploadController controller;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ScholarshipDocumentSlotView view = controller.slot(type);
    final String label = scholarshipDocumentTypeLabel(type);
    final bool busy = view.phase == ScholarshipDocumentSlotPhase.uploading;
    return Semantics(
      container: true,
      explicitChildNodes: true,
      label: '$label, required document',
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border.all(color: theme.colorScheme.outlineVariant),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(label, style: theme.textTheme.titleSmall),
              const SizedBox(height: 4),
              Text(
                _statusText(view),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: view.phase == ScholarshipDocumentSlotPhase.error
                      ? theme.colorScheme.error
                      : theme.colorScheme.onSurfaceVariant,
                ),
              ),
              if (busy) ...<Widget>[
                const SizedBox(height: 8),
                Semantics(
                  label:
                      'Uploading $label, ${(view.progress * 100).round()} percent',
                  child: ExcludeSemantics(
                    child: LinearProgressIndicator(value: view.progress),
                  ),
                ),
              ],
              if (view.phase == ScholarshipDocumentSlotPhase.error &&
                  view.errorMessage != null) ...<Widget>[
                const SizedBox(height: 8),
                Semantics(
                  liveRegion: true,
                  label: view.errorMessage,
                  child: Text(
                    view.errorMessage!,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.error,
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: <Widget>[
                  _PickButton(
                    label: 'Choose a photo for $label',
                    icon: Icons.photo_outlined,
                    enabled: !busy,
                    onPressed: () => controller.pickAndUpload(
                      type,
                      ScholarshipPickSource.gallery,
                    ),
                  ),
                  _PickButton(
                    label: 'Take a photo for $label',
                    icon: Icons.photo_camera_outlined,
                    enabled: !busy,
                    onPressed: () => controller.pickAndUpload(
                      type,
                      ScholarshipPickSource.camera,
                    ),
                  ),
                  _PickButton(
                    label: 'Choose a PDF or image for $label',
                    icon: Icons.upload_file_outlined,
                    enabled: !busy,
                    onPressed: () => controller.pickAndUpload(
                      type,
                      ScholarshipPickSource.file,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _statusText(ScholarshipDocumentSlotView view) {
    switch (view.phase) {
      case ScholarshipDocumentSlotPhase.empty:
        return 'No file yet. PDF, JPEG, or PNG, up to 10 MB.';
      case ScholarshipDocumentSlotPhase.uploading:
        return 'Uploading ${view.filename ?? 'file'}…';
      case ScholarshipDocumentSlotPhase.uploaded:
        return 'Uploaded ${view.filename ?? 'file'}';
      case ScholarshipDocumentSlotPhase.error:
        return view.filename == null
            ? 'Upload failed'
            : 'Could not upload ${view.filename}';
    }
  }
}

class _PickButton extends StatelessWidget {
  const _PickButton({
    required this.label,
    required this.icon,
    required this.enabled,
    required this.onPressed,
  });

  final String label;
  final IconData icon;
  final bool enabled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      enabled: enabled,
      label: label,
      child: OutlinedButton.icon(
        onPressed: enabled ? onPressed : null,
        icon: Icon(icon),
        label: Text(_shortLabel(label)),
        style: OutlinedButton.styleFrom(minimumSize: const Size(48, 48)),
      ),
    );
  }

  String _shortLabel(String semanticsLabel) {
    if (semanticsLabel.startsWith('Choose a photo')) {
      return 'Photo';
    }
    if (semanticsLabel.startsWith('Take a photo')) {
      return 'Camera';
    }
    return 'File';
  }
}
