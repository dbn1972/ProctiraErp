#!/usr/bin/env python3
"""Wave 0 consolidation gate: completeness + evidence gate over triage-group-{1..4}.json.

Writes work/gate-decisions.json (accepted CSV proposals, downgrades, NOT_TRIAGED rows).
Run from anywhere; paths are resolved relative to this file.
"""
import csv
import io
import json
import os
import subprocess

WORK = os.path.dirname(os.path.abspath(__file__))
R = os.path.dirname(WORK)
W = os.path.abspath(os.path.join(R, '..', '..', '..'))
LEDGER_REL = 'docs/audits/remediation/CANONICAL_LEDGER.csv'
WAVE = 'wave0-triage-2026-10-25'

# Manual gate decisions (each backed by a tip check recorded in the reason).
DOWNGRADES = {
    'PRC-L421': {
        'gate_result': 'STILL_OPEN',
        'eligibility': 'NEEDS_DECISION',
        'boundary': 'Merged D6 PR #634 ledger table keeps L421 OPEN ("root cause is a live module/backend, not resolved by deletion"). '
                    'Tip still has the backend cross-board transfer surface (packages/backend/student/src/enrollment/enrollment-routes.ts:523 '
                    '"Shape consumed by the cross-board transfer dashboard", apps/api-gateway/src/rbac-registry.ts:48 GET /transfers/:id) and no '
                    'decision endpoint. Closure-by-deletion contradicts the owner disposition; owner must decide.',
        'reason': 'STALE proposal contradicts merged owner disposition (PR #634); backend surface still live at tip.',
    },
    'PRC-L439': {
        'gate_result': 'STILL_OPEN',
        'eligibility': 'NEEDS_DECISION',
        'boundary': 'Merged D6 PR #634 ledger table keeps L439 OPEN ("root cause is a live module/backend"). Tip grep finds no settings.general '
                    'keys, but the owner disposition was explicit; closing it needs the owner to confirm the live settings surface needs no keys.',
        'reason': 'STALE proposal contradicts merged owner disposition (PR #634).',
    },
    'PRC-M211': {
        'gate_result': 'PARTIAL_CONFIRMED',
        'eligibility': 'NEEDS_DECISION',
        'boundary': 'Title says nothing creates deliveries. At tip fan-out is opt-in: parseWebhookFanOutEvents returns [] when WEBHOOK_FANOUT_EVENTS '
                    'is unset (packages/backend/developer-portal/src/webhook-event-fanout.ts:40), so by default no delivery is created. Default-on '
                    'fan-out is a product/ops decision; migration 113 was not applied to a live DB (NOT VERIFIED).',
        'reason': 'Acceptance not met by default configuration; live-DB half not verified. Triage itself flagged a possible downgrade.',
    },
}
# Accepted triage result, but the CSV row is not rewritten.
CSV_SKIPS = {
    'PRC-L563': 'Row has a pre-existing CSV encoding anomaly (backslash-escaped quotes; RFC 4180 parse yields 12 fields, see '
                'triage-manifest.json ledger_parse_anomalies). Rewriting its notes would re-encode the line, which the row-scoped '
                'edit rule forbids. Triage result kept (PARTIAL_CONFIRMED, already PARTIAL); CSV left unchanged.',
}


def ledger_at_head():
    raw = subprocess.check_output(['git', '-C', W, 'show', 'HEAD:' + LEDGER_REL])
    return {r['id']: r for r in csv.DictReader(io.StringIO(raw.decode('utf-8'), newline=''))}


def log_exists(path):
    return any(os.path.exists(p) for p in (os.path.join(W, path), os.path.join(R, path), path))


def main():
    ledger = ledger_at_head()
    out = {'wave': WAVE, 'accepted': [], 'downgraded': [], 'csv_skipped': [], 'not_triaged': [], 'rows': []}
    for n in range(1, 5):
        inp = json.load(open(os.path.join(WORK, f'group-{n}-input.json')))
        tri = {r['id']: r for r in json.load(open(os.path.join(WORK, f'triage-group-{n}.json')))}
        for row in inp:
            rid = row['id']
            t = tri.get(rid)
            if t is None:
                out['not_triaged'].append({'id': rid, 'group': n})
                out['rows'].append({'id': rid, 'group': n, 'triage_result': 'NOT_TRIAGED', 'gate_result': 'NOT_TRIAGED',
                                    'csv_change': False})
                continue
            res = t['triage_result']
            rec = {'id': rid, 'group': n, 'triage_result': res, 'gate_result': res, 'csv_change': False,
                   'eligibility': t['eligibility'], 'boundary': t['boundary'], 'gate_checks': []}
            p = t['proposed']
            if res == 'STALE':
                ev_ok = any(e.get('file') and e.get('line') not in (None, '') for e in t['evidence'])
                tests_ok = any(x.get('exit_code') == 0 and x.get('log') and log_exists(x['log']) for x in t['tests_run'])
                rec['gate_checks'] = [f'tip file:line evidence: {ev_ok}', f'test exit 0 with existing log: {tests_ok}']
                if not (ev_ok and tests_ok):
                    rec.update(gate_result='STILL_OPEN', eligibility='NEEDS_DECISION',
                               boundary='Gate: STALE lacked tip file:line or passing test log.')
                    out['downgraded'].append({'id': rid, 'from': 'STALE', 'to': 'STILL_OPEN', 'reason': 'evidence bar not met'})
                    out['rows'].append(rec)
                    continue
            if res == 'DUPLICATE':
                twin = t['twin_id']
                ok = twin in ledger and ledger[twin]['disposition'] != 'DUPLICATE' and twin != rid
                rec['gate_checks'] = [f'twin {twin} in ledger and not DUPLICATE: {ok} '
                                      f'(twin disposition {ledger.get(twin, {}).get("disposition")})']
                if not ok:
                    rec.update(gate_result='STILL_OPEN')
                    out['downgraded'].append({'id': rid, 'from': 'DUPLICATE', 'to': 'STILL_OPEN', 'reason': 'twin invalid'})
                    out['rows'].append(rec)
                    continue
            if rid in DOWNGRADES:
                d = DOWNGRADES[rid]
                rec.update(gate_result=d['gate_result'], eligibility=d['eligibility'], boundary=d['boundary'])
                rec['gate_checks'].append('manual gate: ' + d['reason'])
                out['downgraded'].append({'id': rid, 'from': res, 'to': d['gate_result'], 'csv_change': False, **d})
                out['rows'].append(rec)
                continue
            if p and rid in CSV_SKIPS:
                rec['gate_checks'].append('csv skipped: ' + CSV_SKIPS[rid])
                out['csv_skipped'].append({'id': rid, 'reason': CSV_SKIPS[rid]})
                out['rows'].append(rec)
                continue
            if p:
                if p['latest_wave'] != WAVE or not p['notes'].startswith(row['notes']):
                    raise SystemExit(f'{rid}: proposal does not preserve notes or wave')
                rec['csv_change'] = True
                out['accepted'].append({'id': rid, 'triage_result': res, 'old_disposition': ledger[rid]['disposition'],
                                        'new_disposition': p['disposition'], 'latest_wave': p['latest_wave'],
                                        'notes': p['notes'], 'twin_id': t['twin_id']})
            out['rows'].append(rec)
    json.dump(out, open(os.path.join(WORK, 'gate-decisions.json'), 'w'), indent=1)
    from collections import Counter
    print('accepted', len(out['accepted']), Counter(a['triage_result'] for a in out['accepted']))
    print('downgraded', [(d['id'], d['to']) for d in out['downgraded']])
    print('csv_skipped', [d['id'] for d in out['csv_skipped']], 'not_triaged', len(out['not_triaged']))


if __name__ == '__main__':
    main()
