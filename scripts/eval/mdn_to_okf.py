"""Builds an OKF bundle from MDN's files/en-us/web/api, with counterfactual edits for evaluation.

    python3 -I scripts/eval/mdn_to_okf.py <mdn content checkout> <output bundle dir>

The edits make the bundle disagree with the real web platform in a few places, so an answer
taken from memory instead of from the bundle is wrong. EDITS documents each one.
"""

import json
import re
import shutil
import sys
from pathlib import Path

SRC_SUB = Path("files/en-us/web/api")
IMPORTED_AT = "2026-10-30T00:00:00Z"
FM = re.compile(r"^---\n(.*?)\n---\n", re.S)
DOMXREF = re.compile(r"\{\{\s*domxref\(\s*\"([^\"]+)\"(?:\s*,\s*\"([^\"]*)\")?[^}]*\}\}", re.I)
SITE_LINK = re.compile(r"\]\(/en-US/docs/Web/API/([^)#\s]+)(#[^)\s]*)?\)", re.I)


def parse_fm(text):
    m = FM.match(text)
    if not m:
        return {}, text
    data, key = {}, None
    for line in m.group(1).splitlines():
        if line.startswith("  - ") and key:
            data.setdefault(key, []).append(line[4:].strip())
        elif ":" in line and not line.startswith(" "):
            key, _, value = line.partition(":")
            key, value = key.strip(), value.strip().strip('"').strip("'")
            data[key] = value if value else []
    return data, text[m.end():]


def api_path(ref):
    ref = ref.replace("()", "").replace(".", "/")
    return "/" + ref.lower() + ".md"


def convert_body(body):
    def domxref(m):
        target, text = m.group(1), m.group(2) or m.group(1)
        return f"[`{text}`]({api_path(target)})"

    body = DOMXREF.sub(domxref, body)
    return SITE_LINK.sub(lambda m: f"](/{m.group(1).lower()}.md{m.group(2) or ''})", body)


def describe(body):
    for para in re.split(r"\n\s*\n", body):
        p = para.strip()
        if not p or p.startswith(("{{", ">", "#", "<", "|", "```", "-")):
            continue
        p = re.sub(r"\{\{\s*\w+\(\s*\"([^\"]*)\"(?:\s*,\s*\"([^\"]*)\")?[^}]*\}\}", lambda m: m.group(2) or m.group(1), p)
        p = re.sub(r"\{\{[^}]*\}\}", "", p)
        p = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", p)
        p = re.sub(r"[*`]", "", " ".join(p.split()))
        sentence = re.split(r"(?<=[.!?])\s", p)[0]
        return sentence[:200]
    return ""


def yaml_str(s):
    return json.dumps(s, ensure_ascii=False)


def write_concept(out, rel, fm, body):
    lines = ["---"]
    for k, v in fm.items():
        if isinstance(v, str) and v.startswith("{"):
            lines.append(f"{k}: {v}")
        elif isinstance(v, str):
            lines.append(f"{k}: {yaml_str(v)}")
        elif isinstance(v, list):
            lines.append(f"{k}: [{', '.join(yaml_str(x) for x in v)}]")
        else:
            lines.append(f"{k}: {v}")
    lines.append("---")
    path = out / f"{rel}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n" + body)


def build(src, out):
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    descriptions = {}
    for index in sorted((src / SRC_SUB).rglob("index.md")):
        rel = index.parent.relative_to(src / SRC_SUB).as_posix()
        if rel == ".":
            continue
        data, body = parse_fm(index.read_text())
        status = data.get("status") or []
        if isinstance(status, str):
            status = [status]
        desc = describe(body)
        fm = {
            "type": data.get("page-type") or "mdn-page",
            "title": data.get("title") or rel,
            "description": desc,
            "resource": "https://developer.mozilla.org/en-US/docs/" + (data.get("slug") or ""),
            "tags": [s for s in status if s != "deprecated"],
            "status": "deprecated" if "deprecated" in status else "stable",
            "generated": f"{{ by: process:mdn-import, at: {IMPORTED_AT} }}",
            "verified": f"{{ by: process:mdn-ci, at: {IMPORTED_AT} }}",
        }
        write_concept(out, rel, fm, convert_body(body))
        descriptions[rel] = (fm["title"], desc)
    return descriptions


def write_indexes(out, descriptions):
    dirs = {""} | {str(Path(rel).parent) if "/" in rel else "" for rel in descriptions}
    for d in sorted(dirs):
        prefix = d + "/" if d else ""
        children = sorted(r for r in descriptions if r.startswith(prefix) and "/" not in r[len(prefix):])
        lines = ["---\nokf_version: \"0.2\"\n---\n" if d == "" else "", f"# {d or 'Web APIs'}\n"]
        for r in children:
            title, desc = descriptions[r]
            name = r[len(prefix):]
            lines.append(f"* [{title}]({name}.md) - {desc}")
        (out / prefix / "index.md").write_text("\n".join(lines) + "\n")


def edit(out, rel, fm_changes=None, body_prefix="", body_suffix="", drop=()):
    path = out / f"{rel}.md"
    text = path.read_text()
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    head = [l for l in m.group(1).splitlines() if l.split(":")[0] not in set(drop) | set((fm_changes or {}).keys())]
    head += [f"{k}: {v}" for k, v in (fm_changes or {}).items()]
    path.write_text("---\n" + "\n".join(head) + "\n---\n" + body_prefix + text[m.end():] + body_suffix)


EDITS = {
    "c1-sendbeacon": "navigator/sendbeacon is deprecated here in favour of fetch() with keepalive (real web: not deprecated)",
    "c2-broadcastchannel": "broadcastchannel/postmessage claims a 64 KiB limit and is stale; a newer human-reviewed guide says 1 MiB and links to it",
    "c3-localstorage": "window/localstorage claims a 10 MB quota and is unverified; a human-reviewed guide says 5 MiB",
    "c4-cachestorage": "cachestorage/match says ignoreVary is ignored on this platform (real web: honoured)",
    "c5-intersectionobserver": "the IntersectionObserver constructor clamps rootMargin to 100px on this platform",
    "c6-clipboard": "clipboard/writetext is deprecated here in favour of clipboard.write() with a ClipboardItem",
    "c7-geolocation": "getCurrentPosition fails at once when timeout exceeds 10000 ms on this platform",
    "c8-websocket": "a human-reviewed guide, linking to websocket, says the proxy closes WebSockets idle for 45 seconds",
    "c9-indexeddb": "indexeddb_api claims a 50 MB quota and is unverified; the human-reviewed storage guide says 200 MiB",
    "c10-fullscreen": "element/requestfullscreen rejects on this platform unless navigationUI is \"hide\"",
}


def counterfactuals(out):
    edit(
        out,
        "navigator/sendbeacon",
        {"status": "deprecated", "verified": "{ by: human:platform-team, at: 2026-09-15T00:00:00Z }"},
        body_prefix="\n> [!WARNING]\n> Deprecated in our platform baseline (2026-09): our edge proxy drops beacon requests. "
        "Use [`fetch()`](/window/fetch.md) with `keepalive: true` instead.\n",
    )
    edit(
        out,
        "broadcastchannel/postmessage",
        {"stale_after": "2026-08-01T00:00:00Z"},
        body_suffix="\n## Message size limit\n\nMessages larger than 64 KiB are silently dropped by our platform.\n",
    )
    write_concept(
        out,
        "guides/broadcastchannel-limits",
        {
            "type": "Guide",
            "title": "BroadcastChannel limits on our platform",
            "description": "Current message size limit for BroadcastChannel after the 2026-09 platform update.",
            "tags": ["platform", "limits"],
            "status": "stable",
            "generated": "{ by: human:platform-team, at: 2026-09-20T00:00:00Z }",
            "verified": "{ by: human:platform-team, at: 2026-09-20T00:00:00Z }",
            "stale_after": "2027-06-30T00:00:00Z",
        },
        "\nSince the 2026-09 platform update, a single [BroadcastChannel message](/broadcastchannel/postmessage.md) "
        "may be up to 1 MiB. The 64 KiB note on that page predates the update and is outdated.\n",
    )
    edit(
        out,
        "window/localstorage",
        {"generated": "{ by: summarizer_agent/0.3, at: 2026-05-01T00:00:00Z }"},
        body_suffix="\n## Quota\n\nEach origin may store up to 10 MB in `localStorage`.\n",
        drop=("verified",),
    )
    write_concept(
        out,
        "guides/storage-quotas",
        {
            "type": "Guide",
            "title": "Storage quotas on supported browsers",
            "description": "Per-origin quotas for Web Storage and other client storage on the browsers we support.",
            "tags": ["platform", "storage"],
            "status": "stable",
            "generated": "{ by: human:platform-team, at: 2026-08-01T00:00:00Z }",
            "verified": "{ by: human:platform-team, at: 2026-08-01T00:00:00Z }",
        },
        "\n`localStorage` holds at most 5 MiB per origin on every browser we support; "
        "see [Window.localStorage](/window/localstorage.md). "
        "[IndexedDB](/indexeddb_api.md) holds at most 200 MiB per origin.\n",
    )
    edit(
        out,
        "cachestorage/match",
        {"verified": "{ by: human:platform-team, at: 2026-09-01T00:00:00Z }"},
        body_prefix="\n> [!WARNING]\n> On our platform the `ignoreVary` option is ignored by `CacheStorage.match()`; "
        "filter on the `Vary` header yourself.\n",
    )
    edit(
        out,
        "intersectionobserver/intersectionobserver",
        {"verified": "{ by: human:platform-team, at: 2026-09-01T00:00:00Z }"},
        body_prefix="\n> [!WARNING]\n> On our platform `rootMargin` is clamped to at most `100px` on each side; "
        "a larger margin behaves as `100px`. Lower `threshold` or observe a sentinel element placed further ahead instead.\n",
    )
    edit(
        out,
        "clipboard/writetext",
        {"status": "deprecated", "verified": "{ by: human:platform-team, at: 2026-09-01T00:00:00Z }"},
        body_prefix="\n> [!WARNING]\n> Deprecated in our platform baseline (2026-09): `writeText()` fails in our embedded WebView. "
        "Use [`write()`](/clipboard/write.md) with a [`ClipboardItem`](/clipboarditem.md) holding a `text/plain` blob instead.\n",
    )
    edit(
        out,
        "geolocation/getcurrentposition",
        {"verified": "{ by: human:platform-team, at: 2026-09-01T00:00:00Z }"},
        body_prefix="\n> [!WARNING]\n> On our platform a `timeout` above `10000` ms makes the call fail at once with `TIMEOUT`. "
        "Keep `timeout` at 10000 ms or less and retry instead.\n",
    )
    write_concept(
        out,
        "guides/network-limits",
        {
            "type": "Guide",
            "title": "Network limits on our platform",
            "description": "Connection limits that our edge proxy enforces.",
            "tags": ["platform", "network"],
            "status": "stable",
            "generated": "{ by: human:platform-team, at: 2026-09-01T00:00:00Z }",
            "verified": "{ by: human:platform-team, at: 2026-09-01T00:00:00Z }",
        },
        "\nOur edge proxy closes a [WebSocket](/websocket.md) connection that carries no frame for 45 seconds. "
        "Long-lived connections must send an application-level heartbeat more often than that.\n",
    )
    edit(
        out,
        "indexeddb_api",
        {"generated": "{ by: summarizer_agent/0.3, at: 2026-05-01T00:00:00Z }"},
        body_suffix="\n## Quota\n\nEach origin may store up to 50 MB in IndexedDB.\n",
        drop=("verified",),
    )
    edit(
        out,
        "element/requestfullscreen",
        {"verified": "{ by: human:platform-team, at: 2026-09-01T00:00:00Z }"},
        body_prefix="\n> [!WARNING]\n> On our platform `requestFullscreen()` rejects with `TypeError` unless it is called "
        "with `{ navigationUI: \"hide\" }`.\n",
    )
    (out / "guides" / "index.md").write_text(
        "# Guides\n\n"
        "* [BroadcastChannel limits on our platform](broadcastchannel-limits.md) - Current BroadcastChannel message size limit.\n"
        "* [Storage quotas on supported browsers](storage-quotas.md) - Per-origin client storage quotas.\n"
        "* [Network limits on our platform](network-limits.md) - Connection limits of our edge proxy.\n"
    )
    root = out / "index.md"
    root.write_text(root.read_text().replace("# Web APIs\n", "# Web APIs\n\n* [guides](guides/) - Platform guides from the platform team.\n", 1))
    (out / "log.md").write_text(
        "# Log\n\n## 2026-10-30\n* **Import**: MDN web/api imported by process:mdn-import.\n\n"
        "## 2026-09-20\n* **Update**: BroadcastChannel limit raised to 1 MiB; see guides/broadcastchannel-limits.\n"
    )


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    descriptions = build(src, out)
    write_indexes(out, descriptions)
    counterfactuals(out)
    deprecated = sorted(
        p.relative_to(out).with_suffix("").as_posix()
        for p in (out / "navigator").rglob("*.md")
        if p.name != "index.md" and "\nstatus: \"deprecated\"" in p.read_text() or (p.name != "index.md" and "\nstatus: deprecated" in p.read_text())
    )
    print(json.dumps({"concepts": len(descriptions) + 3, "edits": EDITS, "navigator_deprecated": deprecated}, indent=2))


if __name__ == "__main__":
    main()
