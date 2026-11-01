"""Runs requests that never mention the bundle under three conditions and records whether Claude opened it.

    python3 scripts/eval/run_implicit.py <plugin dir> <okf dir> <out dir> [reps] [parallel]

Conditions: none (no plugin), claudemd (a project CLAUDE.md pointing at the bundles), okf (the plugin).
Each condition runs in its own empty directory outside the bundle's source tree.
"""
import json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

plugin, okf_dir, out = sys.argv[1], sys.argv[2], Path(sys.argv[3])
reps, parallel = int(sys.argv[4]) if len(sys.argv) > 4 else 2, int(sys.argv[5]) if len(sys.argv) > 5 else 6
questions = json.loads((Path(__file__).parent / "questions_implicit.json").read_text())
TOOLS = ["Read", "Grep", "Glob", "Bash(ls *)", "Bash(find *)", "Bash(cat *)", "Bash(grep *)", "Bash(head *)",
         "mcp__cc-okf__okf_search", "mcp__cc-okf__okf_index", "ToolSearch"]
CLAUDE_MD = """## OKF bundles

- OKF (Open Knowledge Format) bundles live in ~/.claude/okf/<name>/. For questions they may cover, follow index.md or grep them.
- In a concept, a link starting with `/` is relative to the bundle root, not the filesystem root.
- Prefer concepts whose `verified` has a `human:` entry. Say so when relying on one with `status: deprecated` or past its `stale_after`.
- For `type: Attested Computation`, fill in only the parameters; never rewrite the computation.
"""
# The installed cc-okf is turned off in every condition so a globally enabled copy cannot add its own bundles.
ISOLATE = {"enabledPlugins": {"cc-okf@cc-okf": False}}
OKF_TOUCH = re.compile(r"\.claude/okf|mcp__cc-okf|mdn_api")

for cond in ("none", "claudemd", "okf"):
    (out / "cwd" / cond).mkdir(parents=True, exist_ok=True)
(out / "cwd" / "claudemd" / "CLAUDE.md").write_text(CLAUDE_MD)

def run(job):
    q, cond, rep = job
    path = out / f"{q['id']}.{cond}.{rep}.json"
    if path.exists():
        return
    cmd = ["claude", "-p", "--output-format", "stream-json", "--verbose", "--allowedTools", *TOOLS]
    settings = dict(ISOLATE)
    if cond == "okf":
        cmd += ["--plugin-dir", plugin]
        settings["env"] = {"OKF_DIR": okf_dir}
    cmd += ["--settings", json.dumps(settings)]
    if os.environ.get("EVAL_MODEL"):
        cmd += ["--model", os.environ["EVAL_MODEL"]]
    res = subprocess.run([*cmd, "--", q["text"]], stdin=subprocess.DEVNULL, capture_output=True, text=True,
                         cwd=out / "cwd" / cond)
    tool_uses, result = [], None
    for line in res.stdout.splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") == "assistant":
            for block in ev.get("message", {}).get("content", []):
                if block.get("type") == "tool_use":
                    tool_uses.append({"name": block["name"], "input": block.get("input", {})})
        if ev.get("type") == "result":
            result = ev
    # A usage limit ends the session with is_error and the limit notice as its result.
    if result is None or result.get("is_error"):
        (out / f"{path.stem}.err").write_text(res.stdout[-4000:] + res.stderr[-4000:])
        return
    consulted = any(OKF_TOUCH.search(json.dumps(t)) for t in tool_uses)
    path.write_text(json.dumps({"result": result.get("result", ""), "num_turns": result.get("num_turns"),
                                "total_cost_usd": result.get("total_cost_usd"), "consulted": consulted,
                                "tool_uses": tool_uses}, ensure_ascii=False))

conds = os.environ.get("EVAL_CONDITIONS", "none,claudemd,okf").split(",")
jobs = [(q, c, r) for r in range(reps) for q in questions for c in conds]
with ThreadPoolExecutor(parallel) as pool:
    list(pool.map(run, jobs))
