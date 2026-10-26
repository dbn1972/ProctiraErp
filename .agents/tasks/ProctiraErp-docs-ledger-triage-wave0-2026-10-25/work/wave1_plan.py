#!/usr/bin/env python3
"""Build the Wave 1 batch plan from triage + gate output and prove the expected file sets are disjoint.

Writes work/wave1-batches.json and prints the pairwise-intersection proof (exit 1 if any overlap or
if a selected id is not OPEN/PARTIAL + ELIGIBLE_LOW/ELIGIBLE_MEDIUM after the gate).
"""
import itertools
import json
import os

WORK = os.path.dirname(os.path.abspath(__file__))

EXCLUDED_MODULES = {'institution', 'rbac', 'roles', 'parent-portal', 'db', 'infrastructure', 'github'}
EXCLUDED_ELIG = {'BLOCKED_FOR_APPROVAL', 'SCHEMA_BATCH', 'INFRA_BATCH', 'NEEDS_DECISION', 'CLAIMED'}

BATCHES = [
    {
        'branch': 'fix/app-web-batch1',
        'scope': 'apps/web: route-area UI fixes, dead-client removal, gateway proxy streaming, test-only gaps',
        'ids': ['PRC-L228', 'PRC-L240', 'PRC-L253', 'PRC-L255', 'PRC-L270', 'PRC-L413', 'PRC-L435', 'PRC-L530',
                'PRC-M134', 'PRC-M144', 'PRC-M147', 'PRC-M489'],
        # Extra files beyond triage expected_files (source noted).
        'extra_files': {
            'PRC-L255': ['apps/web/src/app/(dashboard)/institutions/[id]/infrastructure/actions.ts',
                         'apps/web/src/app/(dashboard)/institutions/[id]/infrastructure/page.tsx'],
        },
        'extra_files_source': {'PRC-L255': 'salvage commit 05591952a on fix/web-lows-L255 (orphan-branches.json SALVAGE_CANDIDATE)'},
        'dispositions_csv': 'docs/audits/remediation/app_web_batch1_DISPOSITIONS_2026-10-25.csv',
    },
    {
        'branch': 'fix/ui-packages-batch1',
        'scope': 'packages/ui/* + custom-field (only custom-field rows are eligible)',
        'ids': ['PRC-L447', 'PRC-L448'],
        'extra_files': {},
        'extra_files_source': {},
        'dispositions_csv': 'docs/audits/remediation/ui_packages_batch1_DISPOSITIONS_2026-10-25.csv',
    },
    {
        'branch': 'fix/platform-services-batch1',
        'scope': 'etl, data-warehouse, notification, survey backend packages',
        'ids': ['PRC-L099', 'PRC-L100', 'PRC-L302', 'PRC-L101', 'PRC-L333', 'PRC-M593', 'PRC-L453', 'PRC-L554',
                'PRC-L164', 'PRC-L165'],
        'extra_files': {
            'PRC-L302': ['packages/backend/etl/src/etl-audit.ts', 'packages/backend/etl/src/etl-audit.test.ts',
                         'packages/backend/etl/src/execution-logger.ts', 'packages/backend/etl/src/index.ts'],
            'PRC-L453': ['packages/backend/data-warehouse/src/warehouse-repository.ts',
                         'packages/backend/data-warehouse/src/gis-repository.ts',
                         'packages/backend/data-warehouse/src/in-memory-gis-repository.ts',
                         'packages/backend/data-warehouse/src/translation-repository.ts',
                         'packages/backend/data-warehouse/src/in-memory-translation-repository.ts'],
            'PRC-L164': ['packages/backend/survey/src/safe-regex-guard.ts'],
            'PRC-L333': ['packages/backend/notification/src/channel-sender-factory.ts',
                         'packages/backend/notification/src/sandbox-sms-sender.test.ts'],
        },
        'extra_files_source': {k: 'fix/platform-services-batch1 plan.md (in-flight)' for k in ('PRC-L302', 'PRC-L453', 'PRC-L164', 'PRC-L333')},
        'dispositions_csv': 'docs/audits/remediation/platform_services_batch1_DISPOSITIONS_2026-10-25.csv',
    },
]


def main():
    tri, inp = {}, {}
    for n in range(1, 5):
        for r in json.load(open(os.path.join(WORK, f'triage-group-{n}.json'))):
            tri[r['id']] = r
        for r in json.load(open(os.path.join(WORK, f'group-{n}-input.json'))):
            inp[r['id']] = r
    gate = {r['id']: r for r in json.load(open(os.path.join(WORK, 'gate-decisions.json')))['rows']}
    accepted = {a['id']: a for a in json.load(open(os.path.join(WORK, 'gate-decisions.json')))['accepted']}
    problems = []
    out = []
    for b in BATCHES:
        files, items = set(), []
        for rid in b['ids']:
            t, g = tri[rid], gate[rid]
            disp_after = accepted[rid]['new_disposition'] if rid in accepted else inp[rid]['disposition']
            elig = g['eligibility']
            if disp_after not in ('OPEN', 'PARTIAL') or elig not in ('ELIGIBLE_LOW', 'ELIGIBLE_MEDIUM'):
                problems.append(f'{rid}: disposition {disp_after} eligibility {elig}')
            if t['module'] in EXCLUDED_MODULES or elig in EXCLUDED_ELIG:
                problems.append(f'{rid}: excluded module/eligibility')
            f = list(t['expected_files']) + b['extra_files'].get(rid, [])
            if not f:
                problems.append(f'{rid}: no expected files')
            files.update(f)
            unmet = (t['unmet_steps'] or [None])[0]
            items.append({'id': rid, 'severity': t['severity'], 'module': t['module'], 'disposition_after_wave0': disp_after,
                          'eligibility': elig, 'title': inp[rid]['title'], 'unmet_first': unmet, 'rationale': t['rationale'],
                          'expected_files': f, 'extra_files_source': b['extra_files_source'].get(rid)})
        files.add(b['dispositions_csv'])
        out.append({'branch': b['branch'], 'scope': b['scope'], 'size': len(b['ids']), 'items': items,
                    'files': sorted(files)})
    print('Wave 1 expected-file disjointness proof')
    for b in out:
        print(f"  {b['branch']}: {b['size']} findings, {len(b['files'])} files")
    overlap = False
    for a, c in itertools.combinations(out, 2):
        inter = sorted(set(a['files']) & set(c['files']))
        overlap |= bool(inter)
        print(f"  {a['branch']} ∩ {c['branch']} = {inter if inter else '∅ (empty)'}")
    ids = [i for b in BATCHES for i in b['ids']]
    dup_ids = sorted({i for i in ids if ids.count(i) > 1})
    print(f'  duplicate ids across batches: {dup_ids or "none"}')
    print(f'  eligibility/exclusion problems: {problems or "none"}')
    json.dump({'batches': out, 'pairwise_overlap': overlap, 'problems': problems, 'duplicate_ids': dup_ids},
              open(os.path.join(WORK, 'wave1-batches.json'), 'w'), indent=1)
    raise SystemExit(1 if overlap or problems or dup_ids else 0)


if __name__ == '__main__':
    main()
