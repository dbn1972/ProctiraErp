#!/usr/bin/env python3
"""Single row-scoped pass over CANONICAL_LEDGER.csv applying work/gate-decisions.json accepted proposals.

Only lines of accepted ids are rewritten and only fields 3 (disposition), 4 (latest_wave) and
7 (notes) change. All other raw field bytes on those lines are kept verbatim. A changed field is
quoted when the original raw field was quoted or when the new value needs quoting (RFC 4180).
CRLF line endings and the trailing newline are preserved.
"""
import json
import os

WORK = os.path.dirname(os.path.abspath(__file__))
R = os.path.dirname(WORK)
W = os.path.abspath(os.path.join(R, '..', '..', '..'))
LEDGER = os.path.join(W, 'docs/audits/remediation/CANONICAL_LEDGER.csv')
EOL = b'\r\n'
FIELD_IDX = {'disposition': 3, 'latest_wave': 4, 'notes': 7}


def split_raw(line: str):
    """Split one CSV line into raw field strings (quotes kept), RFC 4180."""
    fields, cur, inq, i = [], [], False, 0
    while i < len(line):
        c = line[i]
        if inq:
            if c == '"':
                if i + 1 < len(line) and line[i + 1] == '"':
                    cur.append('""')
                    i += 2
                    continue
                inq = False
            cur.append(c)
        elif c == '"':
            inq = True
            cur.append(c)
        elif c == ',':
            fields.append(''.join(cur))
            cur = []
        else:
            cur.append(c)
        i += 1
    if inq:
        raise ValueError('unterminated quote')
    fields.append(''.join(cur))
    return fields


def encode(value: str, was_quoted: bool) -> str:
    if was_quoted or any(c in value for c in ',"\r\n'):
        return '"' + value.replace('"', '""') + '"'
    return value


def main():
    gate = json.load(open(os.path.join(WORK, 'gate-decisions.json')))
    acc = {a['id']: a for a in gate['accepted']}
    raw = open(LEDGER, 'rb').read()
    assert raw.endswith(EOL)
    lines = raw[: -len(EOL)].split(EOL)
    seen = set()
    for i, b in enumerate(lines):
        if i == 0:
            continue
        line = b.decode('utf-8')
        rid = line.split(',', 1)[0]
        if rid not in acc:
            continue
        f = split_raw(line)
        if len(f) != 8:
            raise SystemExit(f'{rid}: {len(f)} raw fields, refusing to rewrite')
        a = acc[rid]
        new = {'disposition': a['new_disposition'], 'latest_wave': a['latest_wave'], 'notes': a['notes']}
        for k, idx in FIELD_IDX.items():
            f[idx] = encode(new[k], f[idx].startswith('"'))
        lines[i] = ','.join(f).encode('utf-8')
        seen.add(rid)
    missing = set(acc) - seen
    if missing:
        raise SystemExit(f'ids not found in ledger: {sorted(missing)}')
    open(LEDGER, 'wb').write(EOL.join(lines) + EOL)
    print('rewrote', len(seen), 'rows')


if __name__ == '__main__':
    main()
