#!/usr/bin/env python3
"""Reconcile all wave disposition CSVs into one canonical gap ledger keyed by PRC id.

Why this exists
---------------
The audit backlog was tracked across many per-wave disposition CSVs
(PR2/PR3/PR4, w2_*, w3_*). The SAME finding (PRC id) is re-dispositioned in
successive waves, so naively summing rows across files double/triple-counts and
every report produced a different total. This script collapses all wave CSVs
into ONE row per PRC id, keeping the disposition from the LATEST wave that
touched it. The output, CANONICAL_LEDGER.csv, is the single source of truth.

Rule going forward: when a finding is closed, update its row in
CANONICAL_LEDGER.csv (disposition -> FULLY_CLOSED, cite evidence). Do not add
new per-wave CSVs. Re-run this script only if historical wave CSVs change.

Disposition normalization: FIXED and ALREADY_FIXED collapse to FULLY_CLOSED.
Wave recency: PR2/PR3/PR4 (2026-10-09) < w2_* (2026-10-11) < w3_* (2026-10-12).
"""
import csv, glob, os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))

WAVE_RANK = {
    "PR2_DISPOSITIONS_2026-10-09.csv": 1,
    "PR3_DISPOSITIONS_2026-10-09.csv": 1,
    "PR4_DISPOSITIONS_2026-10-09.csv": 1,
    "w2_backend_a_DISPOSITIONS_2026-10-11.csv": 2,
    "w2_backend_b_DISPOSITIONS_2026-10-11.csv": 2,
    "w2_data_infra_DISPOSITIONS_2026-10-11.csv": 2,
    "w2_web_DISPOSITIONS_2026-10-11.csv": 2,
    "w3_backend_a_DISPOSITIONS_2026-10-12.csv": 3,
    "w3_web_DISPOSITIONS_2026-10-12.csv": 3,
}

def norm(d):
    d = (d or "").strip().upper().replace(" ", "_")
    if d in ("FIXED", "ALREADY_FIXED"):
        return "FULLY_CLOSED"
    return d or "UNKNOWN"

def main():
    canonical = {}  # id -> (rank, row, wave)
    for path in sorted(glob.glob(os.path.join(HERE, "*_DISPOSITIONS_*.csv"))):
        wave = os.path.basename(path)
        rank = WAVE_RANK.get(wave, 0)
        with open(path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                pid = (row.get("id") or "").strip()
                if not pid.startswith("PRC-"):
                    continue
                prev = canonical.get(pid)
                if prev is None or rank >= prev[0]:
                    canonical[pid] = (rank, row, wave)

    tally = defaultdict(int)
    rows_out = []
    for pid, (rank, row, wave) in canonical.items():
        disp = norm(row.get("disposition"))
        tally[disp] += 1
        rows_out.append({
            "id": pid,
            "severity": (row.get("severity") or "").strip().lower(),
            "module": (row.get("module") or "").strip(),
            "disposition": disp,
            "latest_wave": wave,
            "evidence": "",  # filled in when a finding is closed (test/PR/commit)
            "title": (row.get("title") or "").strip(),
            "notes": (row.get("notes") or "").strip(),
        })

    out = os.path.join(HERE, "CANONICAL_LEDGER.csv")
    fields = ["id","severity","module","disposition","latest_wave","evidence","title","notes"]
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in sorted(rows_out, key=lambda r: (r["disposition"], r["severity"], r["id"])):
            w.writerow(row)

    print(f"TOTAL unique findings: {len(canonical)}")
    for d, n in sorted(tally.items(), key=lambda x: -x[1]):
        print(f"  {d:16} {n}")
    print(f"Wrote {out}")

if __name__ == "__main__":
    main()
