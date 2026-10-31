"""Grades saved results against questions.json and prints a table.

    python3 scripts/eval/grade.py <out dir>
"""
import json, re, sys
from collections import defaultdict
from pathlib import Path

out = Path(sys.argv[1])
questions = {q["id"]: q for q in json.loads((Path(__file__).parent / "questions.json").read_text())}
rows = defaultdict(list)
for f in sorted(out.glob("*.json")):
    qid, cond, rep = f.stem.split(".")
    d = json.loads(f.read_text())
    text, q = d.get("result", ""), questions[qid]
    if "recall" in q:
        score = sum(1 for name in q["recall"] if re.search(name, text, re.I)) / len(q["recall"])
    else:
        score = float(all(re.search(p, text) for p in q["all"]))
    rows[(qid, cond)].append((score, d.get("num_turns", 0), d.get("total_cost_usd", 0.0)))

print("| q | base score | okf score | base turns | okf turns | base $ | okf $ |")
print("| --- | --- | --- | --- | --- | --- | --- |")
tot = defaultdict(float)
for qid in questions:
    cells = []
    for i in range(3):
        for cond in ("base", "okf"):
            vals = [r[i] for r in rows[(qid, cond)]]
            avg = sum(vals) / len(vals) if vals else float("nan")
            tot[(i, cond)] += avg
            cells.append(f"{avg:.2f}" if i != 1 else f"{avg:.1f}")
    print(f"| {qid} | " + " | ".join(cells) + " |")
print(f"| total | {tot[(0,'base')]:.2f} | {tot[(0,'okf')]:.2f} | {tot[(1,'base')]:.1f} | {tot[(1,'okf')]:.1f} | {tot[(2,'base')]:.2f} | {tot[(2,'okf')]:.2f} |")
