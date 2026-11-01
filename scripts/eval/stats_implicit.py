"""Tests whether run_implicit.py results differ between conditions, question by question.

    python3 scripts/eval/stats_implicit.py <out dir> [iterations]

Each difference is the mean over questions of the per-question difference in means, so every question
weighs the same however many runs it has. p is a two-sided permutation test that shuffles condition labels
within each question; the interval is a 95% bootstrap that resamples runs within each question and condition,
left out for yes/no metrics, where cells that are all yes or all no make it too narrow.
p-values are Holm-adjusted across all rows printed.
"""
import json, random, re, sys
from collections import defaultdict
from pathlib import Path

out = Path(sys.argv[1])
iters = int(sys.argv[2]) if len(sys.argv) > 2 else 10000
questions = {q["id"]: q for q in json.loads((Path(__file__).parent / "questions_implicit.json").read_text())}
rng = random.Random(0)

runs = defaultdict(list)
for f in sorted(out.glob("*.json")):
    qid, cond, _ = f.stem.split(".")
    d, q = json.loads(f.read_text()), questions[qid]
    runs[(qid, cond)].append({
        "opened": float(d["consulted"]),
        "correct": None if "all" not in q else float(all(re.search(p, d["result"]) for p in q["all"])),
        "turns": float(d["num_turns"] or 0),
        "cost": float(d["total_cost_usd"] or 0.0),
    })


def mean(xs):
    return sum(xs) / len(xs)


def effect(cells):
    return mean([mean(b) - mean(a) for a, b in cells])


def test(metric, a, b):
    cells = []
    for qid in questions:
        xs = [r[metric] for r in runs[(qid, a)] if r[metric] is not None]
        ys = [r[metric] for r in runs[(qid, b)] if r[metric] is not None]
        if xs and ys:
            cells.append((xs, ys))
    if not cells:
        return None
    observed = effect(cells)
    extreme = 0
    for _ in range(iters):
        shuffled = []
        for xs, ys in cells:
            pool = xs + ys
            rng.shuffle(pool)
            shuffled.append((pool[:len(xs)], pool[len(xs):]))
        extreme += abs(effect(shuffled)) >= abs(observed) - 1e-12
    boots = sorted(effect([(rng.choices(xs, k=len(xs)), rng.choices(ys, k=len(ys))) for xs, ys in cells])
                   for _ in range(iters))
    n = sum(len(xs) + len(ys) for xs, ys in cells)
    return observed, boots[int(0.025 * iters)], boots[int(0.975 * iters)], (extreme + 1) / (iters + 1), len(cells), n


ORDER = ["none", "claudemd", "okf", "okfhint"]
conds = sorted({c for _, c in runs}, key=ORDER.index)
kinds = list(dict.fromkeys(q.get("kind", "") for q in questions.values()))
print("| Condition | Runs | Opened | Correct | Avg turns | Avg cost |")
print("| --- | --- | --- | --- | --- | --- |")
for c in conds:
    rs = [r for (_, cc), v in runs.items() if cc == c for r in v]
    cor = [r["correct"] for r in rs if r["correct"] is not None]
    print(f"| {c} | {len(rs)} | {sum(r['opened'] for r in rs):.0f}/{len(rs)} | {sum(cor):.0f}/{len(cor)} "
          f"| {mean([r['turns'] for r in rs]):.2f} | ${mean([r['cost'] for r in rs]):.3f} |")

if len(kinds) > 1:
    print()
    print("| Kind | " + " | ".join(f"{c} opened" for c in conds) + " |")
    print("| --- |" + " --- |" * len(conds))
    for k in kinds:
        cells = [[r["opened"] for qid, q in questions.items() if q.get("kind", "") == k for r in runs[(qid, c)]] for c in conds]
        print(f"| {k} | " + " | ".join(f"{sum(x):.0f}/{len(x)}" for x in cells) + " |")

rows = []
for a, b in (("claudemd", "okf"), ("okf", "okfhint"), ("claudemd", "okfhint"), ("none", "okf"), ("none", "claudemd")):
    if a in conds and b in conds:
        for metric in ("opened", "correct", "turns", "cost"):
            r = test(metric, a, b)
            if r:
                rows.append((f"{b} − {a}", metric, *r))

ranked = sorted(range(len(rows)), key=lambda i: rows[i][5])
adjusted, running = [0.0] * len(rows), 0.0
for rank, i in enumerate(ranked):
    running = max(running, min(1.0, rows[i][5] * (len(rows) - rank)))
    adjusted[i] = running

print()
print("| Comparison | Metric | Difference | 95% CI | p | Holm p | Questions | Runs |")
print("| --- | --- | --- | --- | --- | --- | --- | --- |")
for (cmp, metric, d, lo, hi, p, k, n), padj in zip(rows, adjusted):
    fmt = "{:+.3f}" if metric == "cost" else "{:+.2f}"
    ci = "–" if metric in ("opened", "correct") else f"[{fmt.format(lo)}, {fmt.format(hi)}]"
    print(f"| {cmp} | {metric} | {fmt.format(d)} | {ci} | {p:.4f} | {padj:.4f} | {k} | {n} |")
