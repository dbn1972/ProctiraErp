import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/app_localizations.dart';
import '../bloc/scholarship_bloc.dart';

/// Screen for submitting a scholarship application.
class ScholarshipApplicationScreen extends StatefulWidget {
  const ScholarshipApplicationScreen({
    super.key,
    required this.programId,
    required this.studentId,
  });

  final String programId;
  final String studentId;

  @override
  State<ScholarshipApplicationScreen> createState() =>
      _ScholarshipApplicationScreenState();
}

class _ScholarshipApplicationScreenState
    extends State<ScholarshipApplicationScreen> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _statementCtrl = TextEditingController();
  final TextEditingController _incomeCtrl = TextEditingController();
  bool _agreedToTerms = false;

  @override
  void dispose() {
    _statementCtrl.dispose();
    _incomeCtrl.dispose();
    super.dispose();
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

          return SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    // Personal statement
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

                    // Family income (optional)
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
                    const SizedBox(height: 16),

                    // Document upload placeholder
                    Semantics(
                      button: true,
                      label: 'Upload supporting documents',
                      child: OutlinedButton.icon(
                        onPressed: () {
                          // TODO: Integrate document picker
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Document upload coming soon'),
                            ),
                          );
                        },
                        icon: const Icon(Icons.upload_file_outlined),
                        label: const Text('Upload Documents'),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size.fromHeight(48),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Terms checkbox
                    Semantics(
                      label: 'Agree to terms and conditions',
                      child: CheckboxListTile(
                        value: _agreedToTerms,
                        onChanged: (bool? value) {
                          setState(() => _agreedToTerms = value ?? false);
                        },
                        title: const Text(
                          'I agree to the terms and conditions and certify '
                          'that all information provided is accurate.',
                        ),
                        controlAffinity: ListTileControlAffinity.leading,
                        contentPadding: EdgeInsets.zero,
                      ),
                    ),
                    const SizedBox(height: 24),

                    // Submit button
                    Semantics(
                      button: true,
                      label: 'Submit scholarship application',
                      child: FilledButton(
                        onPressed: isSubmitting ? null : () => _submit(context),
                        style: FilledButton.styleFrom(
                          minimumSize: const Size.fromHeight(48),
                        ),
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
