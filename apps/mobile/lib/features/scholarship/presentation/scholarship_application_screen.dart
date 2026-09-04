import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/di/injector.dart';
import '../../../core/l10n/app_localizations.dart';
import '../bloc/scholarship_bloc.dart';
import '../data/scholarship_repository.dart';

/// Local document selection for a scholarship application.
///
/// There is no dedicated scholarship document upload endpoint; picked files
/// are attached as document metadata on submit (`documents` array) when the
/// user chooses files. Without a storage URL from an upload API, `fileUrl`
/// uses a local `file://` path so the payload matches the API schema.
class _PickedDocument {
  const _PickedDocument({
    required this.documentType,
    required this.fileName,
    required this.fileUrl,
    this.fileSize,
  });

  final String documentType;
  final String fileName;
  final String fileUrl;
  final int? fileSize;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'documentType': documentType,
        'fileName': fileName,
        'fileUrl': fileUrl,
        if (fileSize != null) 'fileSize': fileSize,
      };
}

/// Screen for submitting a scholarship application.
class ScholarshipApplicationScreen extends StatelessWidget {
  const ScholarshipApplicationScreen({
    super.key,
    required this.programId,
    required this.studentId,
  });

  final String programId;
  final String studentId;

  @override
  Widget build(BuildContext context) {
    return BlocProvider<ScholarshipBloc>(
      create: (_) => ScholarshipBloc(
        repository: getIt<ScholarshipRepository>(),
      ),
      child: _ScholarshipApplicationForm(
        programId: programId,
        studentId: studentId,
      ),
    );
  }
}

class _ScholarshipApplicationForm extends StatefulWidget {
  const _ScholarshipApplicationForm({
    required this.programId,
    required this.studentId,
  });

  final String programId;
  final String studentId;

  @override
  State<_ScholarshipApplicationForm> createState() =>
      _ScholarshipApplicationFormState();
}

class _ScholarshipApplicationFormState
    extends State<_ScholarshipApplicationForm> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _statementCtrl = TextEditingController();
  final TextEditingController _incomeCtrl = TextEditingController();
  final ImagePicker _picker = ImagePicker();
  final List<_PickedDocument> _documents = <_PickedDocument>[];
  bool _agreedToTerms = false;

  @override
  void dispose() {
    _statementCtrl.dispose();
    _incomeCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickDocument(ImageSource source) async {
    try {
      final XFile? file = await _picker.pickImage(
        source: source,
        imageQuality: 85,
      );
      if (file == null || !mounted) return;
      final int length = await file.length();
      setState(() {
        _documents.add(
          _PickedDocument(
            documentType: 'supporting_document',
            fileName: file.name,
            fileUrl: 'file://${file.path}',
            fileSize: length,
          ),
        );
      });
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not pick document: $error')),
      );
    }
  }

  void _showPickerSheet() {
    showModalBottomSheet<void>(
      context: context,
      builder: (BuildContext ctx) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              ListTile(
                leading: const Icon(Icons.photo_camera_outlined),
                title: const Text('Take photo'),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickDocument(ImageSource.camera);
                },
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined),
                title: const Text('Choose from gallery'),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickDocument(ImageSource.gallery);
                },
              ),
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: Text(
                  'No scholarship file-upload API is available. Selected '
                  'files are sent as document metadata with a local file URL.',
                  style: TextStyle(fontSize: 12),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  void _submit(BuildContext context) {
    if (!_formKey.currentState!.validate()) return;
    if (!_agreedToTerms) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please agree to the terms and conditions')),
      );
      return;
    }

    context.read<ScholarshipBloc>().add(
          ScholarshipApplicationSubmitted(
            programId: widget.programId,
            studentId: widget.studentId,
            additionalData: <String, dynamic>{
              'personalStatement': _statementCtrl.text.trim(),
              if (_incomeCtrl.text.trim().isNotEmpty)
                'familyIncome': double.tryParse(_incomeCtrl.text.trim()),
              if (_documents.isNotEmpty)
                'documents':
                    _documents.map((_PickedDocument d) => d.toJson()).toList(),
            },
          ),
        );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Semantics(
          header: true,
          child: Text('${l10n.apply} for Scholarship'),
        ),
      ),
      body: BlocConsumer<ScholarshipBloc, ScholarshipState>(
        listener: (BuildContext context, ScholarshipState state) {
          if (state.status == ScholarshipStatus.submitted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Application submitted successfully!'),
              ),
            );
            context.pop();
          } else if (state.status == ScholarshipStatus.error) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(state.errorMessage ?? l10n.error),
              ),
            );
          }
        },
        builder: (BuildContext context, ScholarshipState state) {
          final bool isSubmitting =
              state.status == ScholarshipStatus.submitting;

          final ThemeData theme = Theme.of(context);

          return SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    _SectionCard(
                      title: 'Your statement',
                      children: <Widget>[
                        Semantics(
                          label: 'Personal statement text field',
                          child: TextFormField(
                            controller: _statementCtrl,
                            maxLines: 5,
                            decoration: const InputDecoration(
                              labelText: 'Personal Statement',
                              hintText:
                                  'Describe why you deserve this scholarship…',
                              alignLabelWithHint: true,
                            ),
                            validator: (String? value) {
                              if (value == null || value.trim().isEmpty) {
                                return 'Personal statement is required';
                              }
                              if (value.trim().length < 50) {
                                return 'Please write at least 50 characters';
                              }
                              return null;
                            },
                          ),
                        ),
                        const SizedBox(height: 16),
                        Semantics(
                          label: 'Annual family income field',
                          child: TextFormField(
                            controller: _incomeCtrl,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                              labelText: 'Annual Family Income (optional)',
                              prefixText: '₹ ',
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    _SectionCard(
                      title: 'Documents',
                      children: <Widget>[
                        if (_documents.isNotEmpty) ...<Widget>[
                          for (int i = 0; i < _documents.length; i++)
                            ListTile(
                              contentPadding: EdgeInsets.zero,
                              leading: const Icon(Icons.insert_drive_file_outlined),
                              title: Text(_documents[i].fileName),
                              subtitle: Text(
                                _documents[i].fileSize == null
                                    ? _documents[i].documentType
                                    : '${_documents[i].documentType} · ${_documents[i].fileSize} bytes',
                              ),
                              trailing: IconButton(
                                icon: const Icon(Icons.close),
                                onPressed: () {
                                  setState(() => _documents.removeAt(i));
                                },
                              ),
                            ),
                          const SizedBox(height: 8),
                        ],
                        Semantics(
                          button: true,
                          label: 'Upload supporting documents',
                          child: OutlinedButton.icon(
                            onPressed: _showPickerSheet,
                            icon: const Icon(Icons.upload_file_outlined),
                            label: Text(
                              _documents.isEmpty
                                  ? 'Attach documents'
                                  : 'Attach another document',
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Semantics(
                      label: 'Agree to terms and conditions',
                      child: CheckboxListTile(
                        value: _agreedToTerms,
                        onChanged: (bool? value) {
                          setState(() => _agreedToTerms = value ?? false);
                        },
                        title: Text(
                          'I agree to the terms and conditions and certify '
                          'that all information provided is accurate.',
                          style: theme.textTheme.bodySmall,
                        ),
                        controlAffinity: ListTileControlAffinity.leading,
                        contentPadding: EdgeInsets.zero,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Semantics(
                      button: true,
                      label: 'Submit scholarship application',
                      child: FilledButton(
                        onPressed: isSubmitting ? null : () => _submit(context),
                        child: isSubmitting
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : Text(l10n.submit),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// A titled section grouped into a bordered card (v2.0).
class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(
              title,
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 14),
            ...children,
          ],
        ),
      ),
    );
  }
}
