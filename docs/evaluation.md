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

## Large bundle, requests that never mention it, at scale (2026-11-01, n=10)

The previous experiment again, with ten runs per question and condition (180 sessions, Opus 5.5), to see whether its differences hold. Two changes to the runner: every condition turns off an installed cc-okf, which had otherwise added the table of contents of the author's own bundles to the `none` and `claudemd` conditions; and a session ended by a usage limit is recorded as a failure instead of an answer (118 sessions hit one and were run again). `scripts/eval/stats_implicit.py` compares conditions within each question: p is a permutation test shuffling condition labels within a question, Holm-adjusted over the 12 comparisons.

| Condition | Opened the bundle | Followed the counterfactual (4 × 10) | Avg turns | Avg cost |
| --- | --- | --- | --- | --- |
| No hint | 0/60 | 10/40 | 1.0 | $0.045 |
| `CLAUDE.md`, 4 lines | 60/60 | 39/40 | 5.3 | $0.148 |
| cc-okf | 48/60 | 34/40 | 3.5 | $0.104 |

| cc-okf − `CLAUDE.md` | Difference | 95% CI | Holm p |
| --- | --- | --- | --- |
| Turns | −1.87 | [−2.20, −1.55] | 0.001 |
| Cost | −$0.044 | [−$0.060, −$0.027] | 0.001 |
| Opened | −0.20 | – | 0.001 |
| Followed the counterfactual | −0.12 | – | 0.10 |

- The saving is real: cc-okf took 35% fewer turns and cost 30% less than the `CLAUDE.md` lines, and did so on each of the six questions.
- The bootstrap interval is left out for yes/no rows: most of their cells were all yes, which makes it far too narrow. Fisher's exact test on 34/40 against 39/40 gives p 0.11.
- The accuracy edge from n=2 did not hold. cc-okf followed the counterfactual less often, though not significantly. Its misses were on the `ignoreVary` request (6/10, against 10/10): all four wrong answers came from sessions that never opened the bundle, so the table of contents did not suggest that a service worker caching question touches `CacheStorage.match()`. The two `BroadcastChannel` misses opened the stale note but not the newer guide.
- cc-okf skipped the bundle on the unrelated key handler half the time, and on the beacon request three times in ten, where general knowledge gave the right answer anyway.
- Both hints beat no hint on every measure (Holm p 0.001).
- The answers were in Japanese because of the author's global `CLAUDE.md`. The `ignoreVary` rubric now accepts the Japanese wording; four answers changed to correct after reading them.
- Six questions on one bundle, so the tests generalise over runs, not over requests or bundles.

## Suite for the lookup line (2026-11-01, Haiku, n=1)

A smoke run of the suite prepared for [#14](https://github.com/yokonao/cc-okf/issues/14): six more counterfactuals, 20 requests tagged `counterfactual`, `related` or `unrelated`, and a fourth condition `okfhint` that adds one `CLAUDE.md` line telling Claude to look requests up in the bundles. It checked the pipeline and rubrics, not any difference.

- Coding requests made Claude write files, and with one directory per condition the next run explored them. Each run now gets its own empty directory and cannot use Write or Edit. The n=10 Opus run above was not affected: its tool calls only read.
- Requests saying "our docs site" or "show the user's position" sent Haiku searching the author's repositories or calling macOS location services; they now ask for browser code.
- Haiku opened the bundle in 2/20 sessions under `okf` and 16/20 under `okfhint`. When it did open the bundle on the clipboard and geolocation requests, it read the interface page and missed the edited method page.

## Lookup line, with a static table of contents (2026-11-02, Opus, n=10)

The suite for [#14](https://github.com/yokonao/cc-okf/issues/14) at n=10 (800 sessions, Opus 5.5, Claude Code 2.1.316). The machine seated `cc-plugin-sec-default`, which skips cc-okf's `prompt.context` hook, so `okf` and `okfhint` were replaced by `static` and `statichint`: cc-okf installed, with the output of `scripts/inspect.ts` at 4,000 tokens inlined in the project `CLAUDE.md`, and `statichint` adding the lookup line. The table of contents is inlined because `claude -p` skips a project import of a file outside the project, which needs approval.

| Condition | Opened | Followed the counterfactual (10 × 10) | Avg turns | Avg cost |
| --- | --- | --- | --- | --- |
| No hint | 0/200 | 10/100 | 2.00 | $0.254 |
| `CLAUDE.md`, 4 lines | 158/200 | 77/100 | 4.63 | $0.341 |
| static | 136/200 | 78/100 | 3.89 | $0.374 |
| static + lookup line | 150/200 | 86/100 | 4.18 | $0.379 |

| Kind | `CLAUDE.md` opened | static opened | static + line opened |
| --- | --- | --- | --- |
| counterfactual | 88/100 | 93/100 | 100/100 |
| related | 48/50 | 43/50 | 50/50 |
| unrelated | 22/50 | 0/50 | 0/50 |

| Comparison | Opened | Correct | Turns | Cost |
| --- | --- | --- | --- | --- |
| line − static | +0.07 (0.002) | +0.08 (0.24) | +0.29 (0.09) | +$0.005 (0.47) |
| static − `CLAUDE.md` | −0.11 (0.002) | +0.01 (1.00) | −0.74 (0.002) | +$0.033 (0.002) |
| line − `CLAUDE.md` | −0.04 (0.45) | +0.09 (0.22) | −0.45 (0.004) | +$0.038 (0.002) |

Holm p in brackets, over 20 rows.

- The issue's rule for making the line the default was met. It opened none of the 50 unrelated requests and raised counterfactual answers from 78/100 to 86/100, though not significantly. Most of the gain is the Copy button request (`clipboard.writeText`, 8/10 against 3/10); `ignoreVary` went from 9/10 to 10/10.
- The line cost 0.29 turns and no measurable money; on related requests about 0.6 turns and $0.02. The preamble now carries it, so `okf` and `static` include it and `okfhint` and `statichint` repeat it.
- The table of contents keeps Claude off unrelated requests: the four `CLAUDE.md` lines opened the bundle on 22 of 50.
- The static table of contents took 0.74 fewer turns than the `CLAUDE.md` lines but cost $0.033 more per one-shot session: it adds about 9.5k cache-write tokens to every session, while the lines' extra lookups are mostly cheap cache reads.
- `rootMargin` clamped to 100px: every condition opened the bundle 10/10 but followed the edit 0–3/10. The edit is on the `IntersectionObserver()` constructor page, and sessions read `intersectionobserver/rootmargin.md`, which is not edited. Haiku missed the clipboard and geolocation edits the same way.
- Costs are about five times those of the n=10 run above (`none` $0.254 against $0.045), from a larger global `CLAUDE.md` and MCP tool list on this machine. Compare conditions, not absolute costs.
- 84 sessions failed with an authentication error during a 30-minute outage and were run again; none hit a usage limit.

## Long sessions (2026-11-03, Opus, n=10)

From [#19](https://github.com/yokonao/cc-okf/issues/19). One-shot runs write the table of contents to the cache and never reuse it, so this checks whether it pays for itself over a session. One session sends 16 requests in order: 4 counterfactual, 4 related and 8 unrelated, from `scripts/eval/questions_implicit.json` plus 7 new unrelated requests (Go, regex, Dockerfile, TypeScript, Makefile, Kubernetes, git). Each of the 10 sequences has its own shuffled order, shared by every condition. The first request uses `claude -p --session-id`, the rest `--resume`, with the runner's flags. `okf` and `okfhint` were not run because of `cc-plugin-sec-default`. 40 sessions, 640 requests, Opus 5.5, Claude Code 2.1.316; none failed. The session runner is not in the repository.

Under `--resume`, `total_cost_usd` is the session's running total, so per-request costs are differences.

| Condition | Opened (cf / related / unrelated) | Followed the counterfactual | Avg turns per request | Session cost |
| --- | --- | --- | --- | --- |
| No hint | 0/40 / 0/40 / 0/80 | 5/40 | 1.08 | $0.957 |
| `CLAUDE.md`, 4 lines | 16/40 / 17/40 / 1/80 | 20/40 | 1.52 | $1.192 |
| static | 37/40 / 34/40 / 0/80 | 39/40 | 2.09 | $1.487 |
| static + lookup line | 38/40 / 40/40 / 0/80 | 37/40 | 2.27 | $1.722 |

| Cumulative cost after request | No hint | `CLAUDE.md` | static | static + line |
| --- | --- | --- | --- | --- |
| 1 | $0.238 | $0.283 | $0.330 | $0.341 |
| 4 | $0.369 | $0.466 | $0.572 | $0.644 |
| 8 | $0.531 | $0.675 | $0.842 | $1.009 |
| 16 | $0.957 | $1.192 | $1.487 | $1.722 |

| Comparison | Session cost | Session turns | Counterfactual correct |
| --- | --- | --- | --- |
| static − `CLAUDE.md` | +$0.295 (0.17) | +9.1 (0.17) | +0.48 (0.27) |
| line − static | +$0.235 (0.27) | +2.9 (0.79) | −0.05 (1.00) |
| line − `CLAUDE.md` | +$0.530 (0.036) | +12.0 (0.038) | +0.43 (0.29) |
| static − no hint | +$0.529 (0.036) | +16.2 (0.030) | +0.85 (0.027) |

Holm p in brackets: a sign-flip permutation test paired over the 10 sequences, adjusted over 16 rows.

- No break-even within 16 requests. static stays about $0.30 above the `CLAUDE.md` lines at every position: the gap opens with the first request's cache write and widens with each lookup.
- The expected waste is not there. In a long session the `CLAUDE.md` lines opened the bundle on 1 of 80 unrelated requests. A lookup adds about $0.08–0.10 to a request and does not visibly grow with context, up to about 100k tokens.
- What the table of contents buys is a lookup that starts at all. The `CLAUDE.md` lines followed 77/100 counterfactuals one-shot but 20/40 here; static followed 39/40. With the lines, a counterfactual or related request was looked up 5/49 times before the session's first lookup and 28/31 after; with static, 10/15 and 61/65. A session that opens with unrelated requests answered from memory tends not to start looking. Sessions that look early contribute more requests to "after", so read the split as a tendency.
- The lookup line added lookups on related requests (40/40 against 34/40) and $0.24 per session, with no gain in correctness (37/40 against 39/40).
- So over a session, the table of contents buys correctness, not cost.
- One mix, 16 requests, contexts under about 100k tokens; larger contexts and compaction are untested. static puts the table of contents in `CLAUDE.md`, the hook in the first user message. Reuse of a cached table of contents across sessions is not measured.

## Subagents get the table of contents (2026-11-01, n=1)

In an interactive Claude Code 2.1.316 session with cc-okf and one bundle, a `general-purpose` subagent (Haiku) spawned with the `Agent` tool was asked, with no tools, whether its context held the block. It quoted the preamble line, listed the bundle's `## kakeibo` header and named the `okfBundles` block. So `prompt.context` runs for a subagent's conversation too. This checks that the block arrives, not that a subagent opens the bundle on an implicit request.

## Scan cost (2026-10-31)

Adding a 1,000-concept synthetic bundle (about 2 MB) did not change the time of `claude -p "/okf"`. `scripts/inspect.ts` scans 1,018 concepts in 49 ms and the MDN bundle (8,111 concepts, 48 MB) in about 0.4–1.2 s; three small bundles make a table of contents of about 740 tokens.

## Next

- The lookup line delivered by the hook rather than a static `CLAUDE.md`, on a machine without `cc-plugin-sec-default`.
- Other bundles.
- Long sessions with larger contexts and compaction, and the hook instead of a static table of contents.
- The implicit requests run inside a subagent, to see whether it opens the bundle as the main loop does.
