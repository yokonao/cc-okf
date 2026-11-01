# Evaluation

All runs used `claude -p` with Claude Code 2.1.316. Each condition ran only a few times, on few bundles, so read the numbers as a direction. The recorded runs used Japanese prompts; the scripts now carry English translations of the same questions.

## Small bundle, explicit questions (2026-10-31, n=1)

Bundles: Google's `acme_retail` sample, with one `stale_after` moved into the past, and `ga4`. The baseline got the prompt prefix "OKF knowledge bundles are in ~/.claude/okf/."; cc-okf got the bare question. Questions covered a deprecated metric, an Attested Computation, an unverified definition and a stale computation.

| Question | Baseline turns / cost | cc-okf, tools listed | cc-okf, tools deferred |
| --- | --- | --- | --- |
| Gross margin definition | 5 / $0.189 | 3 / $0.265 | 6 / $0.182 |
| Revenue by channel SQL | 6 / $0.238 | 4 / $0.288 | |
| Trust in a GA4 metric | 5 / $0.228 | 4 / $0.259 | 5 / $0.157 |
| Q3 gross margin | 6 / $0.265 | 7 / $0.339 | |

- Answers were equally correct. With a small, readable bundle the model follows deprecation, staleness and computation rules from the text on its own.
- The difference was in stating trust: the baseline guessed a definition was "probably not reviewed by a person"; cc-okf said it was `unverified`.
- Listing the tools in the prompt changed the tool list and missed the prompt cache shared across sessions, adding about 10k cache-write tokens per session. Deferred behind ToolSearch, the cost fell below the baseline. The tools are deferred since.

## Large bundle, explicit questions (2026-10-31, n=2)

Bundle: MDN `web/api` (mdn/content `a0ba038`) converted by `scripts/eval/mdn_to_okf.py`, 8,111 concepts, with four counterfactual edits:

- `Navigator.sendBeacon()` deprecated in favour of `fetch()` with `keepalive`.
- `BroadcastChannel.postMessage()` claims a 64 KiB limit and is stale; a newer human-reviewed guide, reachable only through its link to that page, says 1 MiB.
- `Window.localStorage` claims 10 MB and is unverified; a human-reviewed guide says 5 MiB.
- `CacheStorage.match()` says `ignoreVary` is ignored on "our platform".

Questions (`scripts/eval/questions.json`) asked about each edit, the real deprecation of `keyCode`, and the deprecated `Navigator` members. Runner `scripts/eval/run.py`, grader `scripts/eval/grade.py` (regular expressions; three misgrades were fixed after reading the answers).

| Condition | Correct | Avg turns | Avg cost | Cache write | Cache read |
| --- | --- | --- | --- | --- | --- |
| Opus 5.5 baseline | 12/12 | 6.3 | $0.170 | 14.0k | 137.8k |
| Opus 5.5 cc-okf, 4,000-token contents | 12/12 | 5.3 | $0.215 | 21.2k | 107.2k |
| Opus 5.5 cc-okf, 1,000-token contents | 12/12 | 6.2 | $0.207 | 18.4k | 142.2k |
| Haiku 5.5 baseline | 12/12 | 8.0 | $0.004 | | |
| Haiku 5.5 cc-okf | 12/12 | 8.0 | $0.004 | | |

- No difference in correctness. Even Haiku found the edited pages and the newer guides with grep and find, and judged staleness and trust itself. Every question contained a word that greps straight to its answer, so this measured reaching an answer once told where to look, not finding the bundle.
- cc-okf cut turns by about 15% but, on one-off questions, the table of contents added cache writes and cost about 25% more on Opus. A 1,000-token table of contents lost the turn savings without saving much.
- One run read the raw MDN checkout next to the working directory instead of the bundle (the answer was still right). Later runs use a working directory away from any source tree.

## Large bundle, requests that never mention it (2026-11-01, n=2)

Same bundle. Six ordinary requests (`scripts/eval/questions_implicit.json`) that say nothing about a bundle, for example "write a service worker that serves a response cached with `Vary: Accept-Language` regardless of language". Four of them hit a counterfactual; two (a localStorage size estimate and an Enter-to-send key handler) only measure whether the bundle was opened.

Conditions, each in its own empty directory: no hint; a project `CLAUDE.md` with four lines saying where the bundles are and how to treat trust and staleness; cc-okf. Runner `scripts/eval/run_implicit.py` records every tool call; "opened" means a call touched the bundle.

| Condition | Opened the bundle | Followed the counterfactual (4 × 2) | Avg turns | Avg cost |
| --- | --- | --- | --- | --- |
| No hint | 0/12 | 2/8 | 1.0 | $0.070 |
| `CLAUDE.md`, 4 lines | 12/12 | 7/8 | 5.8 | $0.202 |
| cc-okf | 10/12 | 8/8 | 3.6 | $0.151 |

- The table of contents prompts a lookup. cc-okf opened the bundle for all five related requests and skipped the key handler. The `CLAUDE.md` lines made Claude grep every time, the key handler included.
- cc-okf took about 40% fewer turns and 25% less cost than the `CLAUDE.md` lines: the table of contents tells it where to look, so fewer `ls` and `grep` calls miss.
- The `CLAUDE.md` condition's miss: it found the stale 64 KiB note but not the newer guide that links to it, and answered that 2 MB "works in an ordinary browser". cc-okf's note on a `Read` lists backlinks, which point at that guide.
- The no-hint condition's correct answers came from general knowledge (`keepalive` for unload beacons).

How the result came out:

- The first cc-okf run was invalid. The change-note baseline kept every session's snapshot under one store key; with 8,000 concepts it passed the store's 4 MB limit, the write threw, and the `prompt.context` hook was skipped, so no table of contents was added. Each session now has its own key, and a failed write no longer affects the table of contents.
- Three `CLAUDE.md` runs had been cut off by a usage limit and were run again.
- The `ignoreVary` rubric was changed to "mentions `ignoreVary` as a platform-specific limitation" and checked against all six answers by hand.

## Subagents get the table of contents (2026-11-01, n=1)

In an interactive Claude Code 2.1.316 session with cc-okf and one bundle, a `general-purpose` subagent (Haiku) spawned with the `Agent` tool was asked, with no tools, whether its context held the block. It quoted the preamble line, listed the bundle's `## kakeibo` header and named the `okfBundles` block. So `prompt.context` runs for a subagent's conversation too. This checks that the block arrives, not that a subagent opens the bundle on an implicit request.

## Scan cost (2026-10-31)

Adding a 1,000-concept synthetic bundle (about 2 MB) did not change the time of `claude -p "/okf"`. `scripts/inspect.ts` scans 1,018 concepts in 49 ms and the MDN bundle (8,111 concepts, 48 MB) in about 0.4–1.2 s; three small bundles make a table of contents of about 740 tokens.

## Next

- More runs, other bundles, other models (Sonnet, Haiku) for the requests that never mention the bundle.
- A long session with several requests, where the table of contents is paid once.
- The implicit requests run inside a subagent, to see whether it opens the bundle as the main loop does.
