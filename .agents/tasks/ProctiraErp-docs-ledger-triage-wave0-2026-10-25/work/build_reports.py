#!/usr/bin/env python3
"""Generate defect-registry.md, deferred-approval-items.md, evidence-manifest.json and the
data tables used by pr-body.md / wave1-batch-plan.md from the committed work/*.json evidence."""
import csv
import io
import json
import os
import subprocess
from collections import Counter

WORK = os.path.dirname(os.path.abspath(__file__))
R = os.path.dirname(WORK)
W = os.path.abspath(os.path.join(R, '..', '..', '..'))
RREL = os.path.relpath(R, W)
LEDGER_REL = 'docs/audits/remediation/CANONICAL_LEDGER.csv'
DEFER = ('BLOCKED_FOR_APPROVAL', 'NEEDS_DECISION', 'SCHEMA_BATCH', 'INFRA_BATCH')


def j(name):
    return json.load(open(os.path.join(WORK, name)))


def cell(s, n=None):
    s = '' if s is None else str(s)
    s = s.replace('\r', ' ').replace('\n', ' ').replace('|', '\\|')
    if n and len(s) > n:
        s = s[: n - 1].rstrip() + '…'
    return s


def ev_short(t, k=2):
    out = []
    for e in (t or {}).get('evidence', [])[:k]:
        f = e.get('file')
        if not f:
            continue
        ln = e.get('line')
        out.append(f'`{f}{":" + str(ln) if ln not in (None, "") else ""}`')
    return ', '.join(out)


def main():
    sha = open(os.path.join(WORK, 'baseline-sha.txt')).read().strip()
    before = j('ledger-before.json')
    manifest = j('triage-manifest.json')
    claimed = j('claimed-and-decision.json')['claimed']
    gate = j('gate-decisions.json')
    diff = j('csv-diff-check.json')
    wave1 = j('wave1-batches.json')
    base_res = j('baseline-results.json')
    gate_rows = {r['id']: r for r in gate['rows']}
    accepted = {a['id']: a for a in gate['accepted']}
    downgraded = {d['id']: d for d in gate['downgraded']}
    skipped = {d['id']: d for d in gate['csv_skipped']}
    tri, inp = {}, {}
    for n in range(1, 5):
        for r in j(f'triage-group-{n}.json'):
            tri[r['id']] = r
        for r in j(f'group-{n}-input.json'):
            inp[r['id']] = r
    base_csv = subprocess.check_output(['git', '-C', W, 'show', f'{sha}:{LEDGER_REL}']).decode('utf-8')
    base_rows = {r['id']: r for r in csv.DictReader(io.StringIO(base_csv, newline=''))}
    new_rows = {r['id']: r for r in csv.DictReader(io.StringIO(open(os.path.join(W, LEDGER_REL), encoding='utf-8', newline='').read()))}
    # L563 has a known parse anomaly; DictReader still yields its first 8 fields correctly for id/sev/module/disposition.

    # ---------------- registry ----------------
    nonclosed_before = [rid for rid, r in base_rows.items() if r['disposition'] not in ('FULLY_CLOSED',)]
    # "non-closed" = OPEN + PARTIAL (the 1 pre-existing DUPLICATE is excluded, as in triage-manifest totals)
    nonclosed_before = [rid for rid in nonclosed_before if base_rows[rid]['disposition'] in ('OPEN', 'PARTIAL')]
    reg = []
    claimed_ids = {c['id']: c for c in claimed}
    for rid in nonclosed_before:
        b = base_rows[rid]
        after = new_rows[rid]['disposition']
        if rid in claimed_ids:
            c = claimed_ids[rid]
            reg.append({'id': rid, 'severity': b['severity'], 'module': b['module'], 'before': b['disposition'], 'after': after,
                        'result': 'CLAIMED', 'eligibility': 'CLAIMED', 'evidence': '',
                        'notes': f"In-flight: {c.get('claim_source')}. Not triaged in Wave 0; no CSV change."})
            continue
        g = gate_rows.get(rid)
        t = tri.get(rid)
        if g is None or g['gate_result'] == 'NOT_TRIAGED':
            reg.append({'id': rid, 'severity': b['severity'], 'module': b['module'], 'before': b['disposition'], 'after': after,
                        'result': 'NOT_TRIAGED', 'eligibility': '', 'evidence': '', 'notes': 'No triage entry; no CSV change.'})
            continue
        res = g['gate_result']
        note_parts = []
        if rid in downgraded:
            d = downgraded[rid]
            note_parts.append(f"GATE DOWNGRADE {d['from']}→{d['to']} (CSV unchanged): {d.get('reason', '')}")
        if rid in skipped:
            note_parts.append('CSV unchanged: pre-existing encoding anomaly on this row.')
        if res == 'DUPLICATE':
            note_parts.append(f"Duplicate of {t['twin_id']}.")
        if g.get('boundary'):
            note_parts.append('Boundary: ' + g['boundary'])
        elif t.get('unmet_steps'):
            note_parts.append('Unmet: ' + '; '.join(t['unmet_steps']))
        elif t.get('rationale'):
            note_parts.append(t['rationale'])
        tests = [x for x in t.get('tests_run') or [] if x.get('exit_code') == 0]
        ev = ev_short(t)
        if tests:
            ev += (' ; ' if ev else '') + f'test exit 0 (`{os.path.basename(tests[0]["log"])}`)'
        reg.append({'id': rid, 'severity': b['severity'], 'module': b['module'], 'before': b['disposition'], 'after': after,
                    'result': res, 'eligibility': g.get('eligibility') or ('n/a (closed)' if after in ('FULLY_CLOSED', 'DUPLICATE') else ''),
                    'evidence': ev, 'notes': ' '.join(note_parts)})
    res_counts = Counter(r['result'] for r in reg)
    elig_counts = Counter(r['eligibility'] for r in reg)
    lines = [
        '# Wave 0 defect registry',
        '',
        f'Every finding that was not closed in `CANONICAL_LEDGER.csv` at baseline `{sha[:8]}` (OPEN or PARTIAL; '
        f'{len(reg)} rows = {before["by_disposition"]["OPEN"]} OPEN + {before["by_disposition"]["PARTIAL"]} PARTIAL). '
        'The single pre-existing DUPLICATE row and the 260 FULLY_CLOSED rows are out of scope.',
        '',
        'Data source: ledger title/notes/evidence plus tip code. The xlsx `docs/audits/gap-analysis/Proctira_Code_Audit_Gaps.xlsx` is '
        'absent from the worktree, git history and host (`triage-manifest.json` → `xlsx`), so Fix steps / Acceptance / Needs were not available.',
        '',
        '`Result` is the result after the consolidation evidence gate (`work/gate-decisions.json`). `After` is the disposition now in the CSV.',
        '',
        '## Counts',
        '',
        '| Result | Rows |', '|---|---|',
    ] + [f'| {k} | {v} |' for k, v in sorted(res_counts.items())] + [f'| **Total** | {len(reg)} |', '',
        '| Eligibility (rows still OPEN/PARTIAL) | Rows |', '|---|---|',
    ] + [f'| {k or "(none)"} | {v} |' for k, v in sorted(elig_counts.items()) if k != 'n/a (closed)'] + ['',
        '## Registry', '',
        '| id | sev | module | before → after | result | eligibility | evidence | notes |', '|---|---|---|---|---|---|---|---|',
    ]
    for r in sorted(reg, key=lambda x: (x['module'], x['id'])):
        lines.append(f"| {r['id']} | {r['severity']} | {r['module']} | {r['before']} → {r['after']} | {r['result']} | "
                     f"{r['eligibility']} | {cell(r['evidence'], 220)} | {cell(r['notes'], 360)} |")
    open(os.path.join(R, 'defect-registry.md'), 'w').write('\n'.join(lines) + '\n')

    # ---------------- deferred approval items ----------------
    dfr = [r for r in reg if r['eligibility'] in DEFER and r['after'] in ('OPEN', 'PARTIAL')]
    dl = ['# Wave 0 deferred approval items', '',
          f'Rows that stay OPEN/PARTIAL and must not enter a fast-mode batch without an owner, specialist or decision '
          f'({len(dfr)} rows). Boundaries come from the triage row (`boundary`) or the consolidation gate. '
          f'Claimed in-flight rows ({res_counts.get("CLAIMED", 0)}) are listed in `defect-registry.md`, not here.', '',
          '| Class | Rows | Route |', '|---|---|---|']
    route = {'BLOCKED_FOR_APPROVAL': 'specialist/owner approval (auth, tenancy, privacy, finance, audit, API contract, dependency)',
             'NEEDS_DECISION': 'owner decision (DECISION_REGISTER.md / row notes / gate conflict)',
             'SCHEMA_BATCH': 'own migration/schema batch with data specialist review',
             'INFRA_BATCH': 'own infra/CI batch with platform review'}
    cc = Counter(r['eligibility'] for r in dfr)
    for k in DEFER:
        dl.append(f'| {k} | {cc.get(k, 0)} | {route[k]} |')
    for k in DEFER:
        rows = [r for r in dfr if r['eligibility'] == k]
        dl += ['', f'## {k} ({len(rows)})', '', '| id | sev | module | disposition | boundary |', '|---|---|---|---|---|']
        for r in sorted(rows, key=lambda x: (x['module'], x['id'])):
            g = gate_rows[r['id']]
            b = g.get('boundary') or '; '.join(tri[r['id']].get('unmet_steps') or []) or tri[r['id']].get('rationale', '')
            if r['id'] in downgraded:
                b = '[gate] ' + b
            dl.append(f"| {r['id']} | {r['severity']} | {r['module']} | {r['after']} | {cell(b, 420)} |")
    open(os.path.join(R, 'deferred-approval-items.md'), 'w').write('\n'.join(dl) + '\n')

    # ---------------- evidence manifest ----------------
    cmds = []
    for c in base_res['commands']:
        cmds.append({'command': c['command'], 'exit_code': c['exit_code'], 'log': os.path.relpath(c['log'], W), 'step': 'baseline'})
    for g in base_res['server_guard']:
        cmds.append({'command': f"~/bin/server-guard.sh (before {g['before']})", 'exit_code': g['exit_code'],
                     'log': os.path.relpath(g['output_log'], W), 'step': 'baseline'})
    tests_run, seen = [], set()
    for n in range(1, 5):
        for r in j(f'triage-group-{n}.json'):
            for x in r.get('tests_run') or []:
                key = (x['command'], x['log'])
                if key in seen:
                    for t in tests_run:
                        if (t['command'], t['log']) == key and r['id'] not in t['ids']:
                            t['ids'].append(r['id'])
                    continue
                seen.add(key)
                tests_run.append({'command': x['command'], 'exit_code': x['exit_code'], 'log': x['log'],
                                  'log_exists': os.path.exists(os.path.join(W, x['log'])), 'step': f'triage-g{n}', 'ids': [r['id']]})
    lc = f'{RREL}/logs/consolidation'
    cmds += [
        {'command': f'python3 {RREL}/work/gate.py', 'exit_code': 0, 'log': f'{lc}/gate.log', 'step': 'consolidation'},
        {'command': f'python3 {RREL}/work/apply_ledger.py', 'exit_code': 0, 'log': f'{lc}/apply.log', 'step': 'consolidation'},
        {'command': f'python3 {RREL}/work/verify_ledger.py', 'exit_code': 0, 'log': f'{lc}/verify.log', 'step': 'consolidation'},
        {'command': f'python3 {RREL}/work/wave1_plan.py', 'exit_code': 0, 'log': f'{lc}/wave1-disjointness.log', 'step': 'consolidation'},
        {'command': 'gh pr list --state open --json number,headRefName,mergeable,mergeStateStatus,updatedAt', 'exit_code': 0,
         'log': None, 'step': 'consolidation (in-flight refresh; output summarised in baseline-assessment.md)'},
    ]
    not_verified = [
        'xlsx Fix steps / Acceptance / Needs: file absent; triage judged rows against ledger title/notes only.',
        'Live/PG-gated suites (DATABASE_URL/REDIS_URL unset): all *.live.test.ts and PG repository paths, incl. library PG claimCopyForCheckout (PRC-M292 PG path), developer-portal migration 113 (PRC-M211), db rows from PR #650.',
        'Flutter/Dart tests (no toolchain): mobile rows and PRC-M254.',
        'Web/Flutter e2e, build-only gates and root check:* scripts were not run.',
        'No test command was run during consolidation (ledger/doc-only change); no server-guard run was needed for it.',
        'Wave 1 expected file sets are planning estimates from triage + in-flight plans; actual diffs may differ.',
        'Why main CI is green while 27 package lint tasks fail at baseline was not investigated.',
        'docs/audits/remediation/README.md status table (180/207/371) is stale and was not updated (out of scope).',
    ]
    ev = {
        'sha': sha, 'branch': 'docs/ledger-triage-wave0',
        'commands': cmds, 'tests_run': tests_run,
        'csv_diff_check': diff,
        'counts_before': diff['counts_before'], 'counts_after': diff['counts_after'],
        'registry_rows': len(reg), 'registry_result_counts': dict(res_counts),
        'accepted_changes': {'total': len(accepted), 'by_result': dict(Counter(a['triage_result'] for a in accepted.values())),
                             'transitions': diff['transitions']},
        'gate_downgrades': [{k: d[k] for k in ('id', 'from', 'to', 'reason')} for d in gate['downgraded']],
        'csv_skipped': gate['csv_skipped'], 'not_triaged': gate['not_triaged'],
        'wave1': [{'branch': b['branch'], 'size': b['size'], 'ids': [i['id'] for i in b['items']]} for b in wave1['batches']],
        'not_verified': not_verified,
    }
    json.dump(ev, open(os.path.join(R, 'evidence-manifest.json'), 'w'), indent=1)

    # ---------------- PR table + overlap data ----------------
    tab = ['| id | old → new | result | evidence |', '|---|---|---|---|']
    order = {'STALE': 0, 'DUPLICATE': 1, 'PARTIAL_CONFIRMED': 2}
    for a in sorted(accepted.values(), key=lambda a: (order[a['triage_result']], a['old_disposition'], a['id'])):
        t = tri[a['id']]
        if a['triage_result'] == 'DUPLICATE':
            e = f"duplicate of {a['twin_id']}; {t['rationale']}"
        elif a['triage_result'] == 'STALE':
            tests = [x for x in t['tests_run'] if x['exit_code'] == 0]
            e = f"{ev_short(t, 2)}; test exit 0 `{os.path.basename(tests[0]['log'])}`"
        else:
            met = ev_short(t, 1)
            rest = ('unmet: ' + t['unmet_steps'][0]) if t.get('unmet_steps') else t['rationale']
            e = f'met at {met}; {rest}' if met else rest
        tab.append(f"| {a['id']} | {a['old_disposition']} → {a['new_disposition']} | {a['triage_result']} | {cell(e, 200)} |")
    open(os.path.join(WORK, 'pr-ledger-table.md'), 'w').write('\n'.join(tab) + '\n')
    ch = set(accepted)
    ov = {'overlap_652_changed': sorted(ch & set(manifest['overlap_652'])),
          'overlap_630_effective_changed': sorted(ch & set(manifest['overlap_630_effective_vs_main'])),
          'overlap_630_all_changed_count': len(ch & set(manifest['overlap_630']))}
    json.dump(ov, open(os.path.join(WORK, 'pr-overlap.json'), 'w'), indent=1)
    # PR body from template; reviewer verdict comes from review/review.json when present.
    verdict = 'PENDING: independent review not yet run (`review/review.json` absent).'
    rj = os.path.join(R, 'review', 'review.json')
    if os.path.exists(rj):
        rv = json.load(open(rj))
        verdict = f"{rv.get('verdict')} (see `{os.path.relpath(rv.get('reviewDoc', 'review/review.md'), R) if os.path.isabs(rv.get('reviewDoc', '')) else rv.get('reviewDoc', 'review/review.md')}`)"
    body = open(os.path.join(WORK, 'pr-body.template.md')).read()
    body = (body.replace('__LEDGER_TABLE__', '\n'.join(tab))
            .replace('__OVERLAP_652__', ', '.join(ov['overlap_652_changed']) or 'none')
            .replace('__OVERLAP_630_ALL__', str(ov['overlap_630_all_changed_count']))
            .replace('__OVERLAP_630_N__', str(len(ov['overlap_630_effective_changed'])))
            .replace('__OVERLAP_630__', ', '.join(ov['overlap_630_effective_changed']) or 'none')
            .replace('__REVIEW_VERDICT__', verdict))
    open(os.path.join(R, 'pr-body.md'), 'w').write(body)
    print('tests_run all exit 0', all(t['exit_code'] == 0 for t in tests_run))
    print('registry', len(reg), dict(res_counts))
    print('deferred', len(dfr), dict(cc))
    print('tests_run', len(tests_run), 'all logs exist', all(t['log_exists'] for t in tests_run))
    print('overlap', ov)


if __name__ == '__main__':
    main()
