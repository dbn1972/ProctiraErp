import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/app_localizations.dart';
import '../../../core/student/student_route.dart';
import '../../students/presentation/student_picker.dart';
import '../bloc/scholarship_bloc.dart';
import '../data/scholarship_repository.dart';

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
    final String id = studentId.trim();
    return StudentRequiredGate(
      studentId: id,
      title: 'Apply for scholarship',
      locationFor: (String picked) => withStudentQuery(
        '/scholarships/apply/$programId',
        picked,
      ),
      child: BlocProvider<ScholarshipBloc>(
        create: (BuildContext context) => ScholarshipBloc(
          repository: context.read<ScholarshipRepository>(),
        ),
        child: _ScholarshipApplicationForm(
          programId: programId,
          studentId: id,
        ),
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
  bool _agreedToTerms = false;
  bool _started = false;
  bool _loadingProgram = true;
  ScholarshipProgram? _program;
  String? _programError;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        unawaited(_loadProgram());
      }
    });
  }

  Future<void> _loadProgram() async {
    setState(() {
      _loadingProgram = true;
      _programError = null;
    });
    try {
      final ScholarshipProgram? program = await context
          .read<ScholarshipRepository>()
          .findProgram(widget.programId);
      if (!mounted) {
        return;
      }
      setState(() {
        _program = program;
        _loadingProgram = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _programError = error.toString();
        _loadingProgram = false;
      });
    }
  }

  @override
  void dispose() {
    _statementCtrl.dispose();
    _incomeCtrl.dispose();
    super.dispose();
  }

  void _submit(BuildContext context) {
    if (widget.studentId.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Choose a student before submitting.')),
      );
      return;
    }
    final ScholarshipProgram? program = _program;
    if (program == null || !program.acceptsApplications) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'This scholarship is closed or the deadline has passed.',
          ),
        ),
      );
      return;
    }
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
            },
          ),
        );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    if (_loadingProgram) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (_programError != null) {
      return _BlockedApplication(
        title: 'Could not confirm this scholarship',
        message:
            'The program could not be loaded, so the application stays closed. Try again when you are online.',
        actionLabel: l10n.retry,
        onAction: _loadProgram,
      );
    }
    if (_program == null || !_program!.acceptsApplications) {
      return const _BlockedApplication(
        title: 'Applications are closed',
        message:
            'This scholarship is closed or the deadline has passed. You cannot submit an application.',
      );
    }

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
                    // Your statement section.
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

                    // Documents — upload API not wired on mobile yet (PARTIAL).
                    _SectionCard(
                      title: 'Documents',
                      children: <Widget>[
                        Text(
                          'Supporting document upload is not available in this '
                          'app build yet. Submit the application without files, '
                          'or attach documents from the web portal.',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Semantics(
                          button: true,
                          enabled: false,
                          label: 'Upload supporting documents unavailable',
                          child: OutlinedButton.icon(
                            onPressed: null,
                            icon: const Icon(Icons.upload_file_outlined),
                            label: const Text('Upload Documents'),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),

                    // Terms checkbox.
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

                    // Submit button — full-width FilledButton.
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

class _BlockedApplication extends StatelessWidget {
  const _BlockedApplication({
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Scholarship application'),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                Icons.event_busy_outlined,
                size: 48,
                color: theme.colorScheme.onSurfaceVariant,
              ),
              const SizedBox(height: 16),
              Text(
                title,
                style: theme.textTheme.titleMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                message,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
              ),
              if (onAction != null && actionLabel != null) ...<Widget>[
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: onAction,
                  child: Text(actionLabel!),
                ),
              ],
            ],
          ),
        ),
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
