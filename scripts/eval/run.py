"""Runs each question under each condition with `claude -p` and saves the JSON results.

    python3 scripts/eval/run.py <plugin dir> <out dir> [reps] [parallel]
"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

plugin, out = sys.argv[1], Path(sys.argv[2])
reps, parallel = int(sys.argv[3]) if len(sys.argv) > 3 else 2, int(sys.argv[4]) if len(sys.argv) > 4 else 6
questions = json.loads((Path(__file__).parent / "questions.json").read_text())
out.mkdir(parents=True, exist_ok=True)
TOOLS = ["Read", "Grep", "Glob", "Bash(ls *)", "Bash(find *)", "Bash(cat *)", "Bash(grep *)", "Bash(head *)",
         "mcp__cc-okf__okf_search", "mcp__cc-okf__okf_index", "ToolSearch"]
SUFFIX = " Answer from the bundle."

def run(job):
    q, cond, rep = job
    path = out / f"{q['id']}.{cond}.{rep}.json"
    if path.exists():
        return
    prompt = (f"OKF knowledge bundles are in ~/.claude/okf/. {q['text']}{SUFFIX}" if cond == "base"
              else f"{q['text']}{SUFFIX}")
    cmd = ["claude", "-p", "--output-format", "json", "--allowedTools", *TOOLS]
    if os.environ.get("EVAL_MODEL"):
        cmd += ["--model", os.environ["EVAL_MODEL"]]
    if cond == "okf":
        cmd[2:2] = ["--plugin-dir", plugin]
    res = subprocess.run([*cmd, "--", prompt], stdin=subprocess.DEVNULL, capture_output=True, text=True, cwd=out)
    if res.returncode == 0:
        path.write_text(res.stdout)
    else:
        (out / f"{path.stem}.err").write_text(res.stdout + res.stderr)

import os
conds = os.environ.get("EVAL_CONDITIONS", "base,okf").split(",")
jobs = [(q, c, r) for r in range(reps) for q in questions for c in conds]
with ThreadPoolExecutor(parallel) as pool:
    list(pool.map(run, jobs))
