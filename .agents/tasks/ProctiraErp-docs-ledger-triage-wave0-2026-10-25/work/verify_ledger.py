#!/usr/bin/env python3
"""Verify the row-scoped ledger edit against the baseline and write work/csv-diff-check.json."""
import csv
import hashlib
import io
import json
import os
import subprocess
from collections import Counter

WORK = os.path.dirname(os.path.abspath(__file__))
R = os.path.dirname(WORK)
W = os.path.abspath(os.path.join(R, '..', '..', '..'))
LEDGER_REL = 'docs/audits/remediation/CANONICAL_LEDGER.csv'
EOL = b'\r\n'
ALLOWED = {'disposition', 'latest_wave', 'notes'}


def parse(raw: bytes):
    rows = {}
    for b in raw[: -len(EOL)].split(EOL)[1:]:
        line = b.decode('utf-8')
        rid = line.split(',', 1)[0]
        r = next(csv.reader([line]))
        rows[rid] = r
    return rows


def main():
    baseline_sha = open(os.path.join(WORK, 'baseline-sha.txt')).read().strip()
    before = json.load(open(os.path.join(WORK, 'ledger-before.json')))
    gate = json.load(open(os.path.join(WORK, 'gate-decisions.json')))
    base = subprocess.check_output(['git', '-C', W, 'show', f'{baseline_sha}:{LEDGER_REL}'])
    new = open(os.path.join(W, LEDGER_REL), 'rb').read()
    bl, nl = base.split(EOL), new.split(EOL)
    hdr = next(csv.reader([bl[0].decode()]))
    checks = {}
    checks['baseline_sha'] = baseline_sha
    checks['baseline_sha256'] = hashlib.sha256(base).hexdigest()
    checks['baseline_sha256_matches_ledger_before'] = checks['baseline_sha256'] == before['sha256']
    checks['new_sha256'] = hashlib.sha256(new).hexdigest()
    checks['line_count_equal'] = len(bl) == len(nl)
    checks['crlf_only'] = new.count(b'\n') == new.count(b'\r\n')
    checks['trailing_newline'] = new.endswith(EOL)
    checks['header_identical'] = bl[0] == nl[0]
    data_rows = len(nl) - 2  # header + trailing empty element
    checks['data_rows'] = data_rows
    checks['data_rows_expected'] = before['rows']
    checks['data_rows_ok'] = data_rows == before['rows']
    order_same = all(b.split(b',', 1)[0] == n.split(b',', 1)[0] for b, n in zip(bl, nl))
    checks['row_order_identical'] = order_same
    changed_lines = [i for i, (b, n) in enumerate(zip(bl, nl)) if b != n]
    changed_ids = {nl[i].split(b',', 1)[0].decode() for i in changed_lines}
    accepted = {a['id'] for a in gate['accepted']}
    checks['changed_line_count'] = len(changed_lines)
    checks['changed_ids_equal_accepted'] = changed_ids == accepted
    checks['changed_not_accepted'] = sorted(changed_ids - accepted)
    checks['accepted_not_changed'] = sorted(accepted - changed_ids)
    br, nr = parse(base), parse(new)
    bad_cols = {}
    value_mismatch = []
    acc = {a['id']: a for a in gate['accepted']}
    for rid in changed_ids:
        diff = {hdr[k] for k in range(8) if br[rid][k] != nr[rid][k]}
        if not diff <= ALLOWED:
            bad_cols[rid] = sorted(diff - ALLOWED)
        a = acc.get(rid)
        if a and (nr[rid][3], nr[rid][4], nr[rid][7]) != (a['new_disposition'], a['latest_wave'], a['notes']):
            value_mismatch.append(rid)
        # raw bytes of untouched fields identical
    checks['changed_rows_only_allowed_columns'] = not bad_cols
    checks['disallowed_column_changes'] = bad_cols
    checks['changed_values_match_proposals'] = not value_mismatch
    checks['value_mismatch'] = value_mismatch
    checks['latest_wave_values'] = sorted({nr[r][4] for r in changed_ids})
    checks['unchanged_lines_byte_identical'] = all(bl[i] == nl[i] for i in range(len(bl)) if i not in set(changed_lines))
    # quoting style: notes field quoted iff original quoted or needed
    def disp_counts(rows):
        return dict(sorted(Counter(r[3] for r in rows.values()).items()))
    checks['counts_before'] = disp_counts(br)
    checks['counts_after'] = disp_counts(nr)
    checks['counts_before_match_ledger_before'] = checks['counts_before'] == dict(sorted(before['by_disposition'].items()))
    trans = Counter(f'{br[r][3]}->{nr[r][3]}' for r in changed_ids)
    checks['transitions'] = dict(sorted(trans.items()))
    by_result = Counter(a['triage_result'] for a in gate['accepted'])
    checks['accepted_by_triage_result'] = dict(by_result)
    moved = sum(v for k, v in trans.items() if k.endswith('->FULLY_CLOSED') or k.endswith('->DUPLICATE'))
    checks['stale_plus_duplicate'] = by_result.get('STALE', 0) + by_result.get('DUPLICATE', 0)
    checks['moved_to_closed_or_duplicate'] = moved
    checks['stale_dup_reconciles'] = moved == checks['stale_plus_duplicate']
    gates = ['baseline_sha256_matches_ledger_before', 'line_count_equal', 'crlf_only', 'trailing_newline', 'header_identical',
             'data_rows_ok', 'row_order_identical', 'changed_ids_equal_accepted', 'changed_rows_only_allowed_columns',
             'changed_values_match_proposals', 'unchanged_lines_byte_identical', 'counts_before_match_ledger_before',
             'stale_dup_reconciles']
    checks['all_pass'] = all(checks[g] for g in gates) and checks['latest_wave_values'] == ['wave0-triage-2026-10-25']
    json.dump(checks, open(os.path.join(WORK, 'csv-diff-check.json'), 'w'), indent=1)
    print(json.dumps({k: checks[k] for k in gates + ['all_pass', 'counts_before', 'counts_after', 'transitions', 'data_rows']}, indent=1))
    raise SystemExit(0 if checks['all_pass'] else 1)


if __name__ == '__main__':
    main()
