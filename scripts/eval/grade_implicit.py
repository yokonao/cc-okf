"""Grades run_implicit.py results: how often Claude opened the bundle, and how often the answer follows it.

    python3 scripts/eval/grade_implicit.py <out dir>
"""
import json, re, sys
from collections import defaultdict
from pathlib import Path

out = Path(sys.argv[1])
questions = {q["id"]: q for q in json.loads((Path(__file__).parent / "questions_implicit.json").read_text())}
ORDER = ("none", "claudemd", "okf", "okfhint")
cells = defaultdict(list)
for f in sorted(out.glob("*.json")):
    qid, cond, _ = f.stem.split(".")
    d = json.loads(f.read_text())
    q = questions[qid]
    correct = None if "all" not in q else all(re.search(p, d["result"]) for p in q["all"])
    cells[(qid, cond)].append((d["consulted"], correct, d["num_turns"] or 0, d["total_cost_usd"] or 0.0))

CONDS = [c for c in ORDER if any(k[1] == c for k in cells)]


def frac(xs):
    xs = [x for x in xs if x is not None]
    return f"{sum(xs)}/{len(xs)}" if xs else "-"

print("| q | kind | " + " | ".join(f"{c} opened" for c in CONDS) + " | " + " | ".join(f"{c} correct" for c in CONDS) + " |")
print("|" + " --- |" * (2 + 2 * len(CONDS)))
totals = defaultdict(list)
for qid in questions:
    row = [frac([r[0] for r in cells[(qid, c)]]) for c in CONDS] + [frac([r[1] for r in cells[(qid, c)]]) for c in CONDS]
    for c in CONDS:
        totals[(c, "o")] += [r[0] for r in cells[(qid, c)]]
        totals[(c, "c")] += [r[1] for r in cells[(qid, c)]]
        totals[(c, "t")] += [r[2] for r in cells[(qid, c)]]
        totals[(c, "$")] += [r[3] for r in cells[(qid, c)]]
    print(f"| {qid} | {questions[qid].get('kind', '')} | " + " | ".join(row) + " |")
print("| total | | " + " | ".join(frac(totals[(c, "o")]) for c in CONDS) + " | " + " | ".join(frac(totals[(c, "c")]) for c in CONDS) + " |")
for c in CONDS:
    t, s = totals[(c, "t")], totals[(c, "$")]
    print(f"{c}: avg turns {sum(t)/max(len(t),1):.1f}, avg cost ${sum(s)/max(len(s),1):.3f}")
