import 'package:flutter/material.dart';

import '../../../core/di/injector.dart';
import '../data/staff_repository.dart';

/// Staff profile with appraisals + training certifications when available.
class StaffDetailScreen extends StatefulWidget {
  const StaffDetailScreen({super.key, required this.staffId});

  final String staffId;

  @override
  State<StaffDetailScreen> createState() => _StaffDetailScreenState();
}

class _StaffDetailScreenState extends State<StaffDetailScreen> {
  late Future<StaffDetailBundle?> _future;

  @override
  void initState() {
    super.initState();
    _future = getIt<StaffRepository>().getStaffDetail(widget.staffId);
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Staff profile')),
      body: FutureBuilder<StaffDetailBundle?>(
        future: _future,
        builder:
            (BuildContext context, AsyncSnapshot<StaffDetailBundle?> snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final StaffDetailBundle? bundle = snap.data;
          if (bundle == null) {
            return Center(
              child: Text(
                'Staff record unavailable',
                style: theme.textTheme.bodyLarge,
              ),
            );
          }
          final StaffMember staff = bundle.staff;
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
            children: <Widget>[
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: <Widget>[
                      CircleAvatar(
                        radius: 28,
                        child: Text(
                          staff.fullName.isNotEmpty
                              ? staff.fullName[0].toUpperCase()
                              : '?',
                          style: const TextStyle(fontSize: 22),
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              staff.fullName,
                              style: theme.textTheme.titleLarge?.copyWith(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              <String>[
                                if (staff.identityNumber != null)
                                  staff.identityNumber!,
                                staff.position,
                                staff.status,
                              ].join(' · '),
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text('Contact', style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              Card(
                child: Column(
                  children: <Widget>[
                    ListTile(
                      leading: const Icon(Icons.phone_outlined),
                      title: Text(staff.contactPhone ?? '—'),
                      subtitle: const Text('Phone'),
                    ),
                    ListTile(
                      leading: const Icon(Icons.email_outlined),
                      title: Text(staff.contactEmail ?? '—'),
                      subtitle: const Text('Email'),
                    ),
                    ListTile(
                      leading: const Icon(Icons.cake_outlined),
                      title: Text(staff.dateOfBirth ?? '—'),
                      subtitle: const Text('Date of birth'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              Text('Appraisals', style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              if (bundle.appraisals.isEmpty)
                const Card(
                  child: ListTile(
                    title: Text('No appraisals on file'),
                  ),
                )
              else
                ...bundle.appraisals.map(
                  (StaffAppraisal a) => Card(
                    child: ListTile(
                      title: Text(a.appraisalDate),
                      subtitle: Text(a.overallComment ?? a.status),
                      trailing: Text(
                        a.totalScore.toString(),
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                  ),
                ),
              const SizedBox(height: 20),
              Text('Training', style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              if (bundle.certifications.isEmpty)
                const Card(
                  child: ListTile(
                    title: Text('No certifications on file'),
                  ),
                )
              else
                ...bundle.certifications.map(
                  (StaffCertification c) => Card(
                    child: ListTile(
                      title: Text(c.certificationName),
                      subtitle: Text(
                        <String>[
                          'Issued ${c.issuedDate}',
                          if (c.expiryDate != null) 'Expires ${c.expiryDate}',
                          c.status,
                        ].join(' · '),
                      ),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
