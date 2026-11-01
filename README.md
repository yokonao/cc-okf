# cc-okf

A [Claude Code](https://claude.com/claude-code) plugin that gives [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/open-knowledge-format) bundles the treatment Claude Code gives skills and memory. Put a bundle in `~/.claude/okf/`, and every conversation, subagents included, knows what it holds and how far to trust each concept.

It reads bundles and never writes them.

## What it does

- **Table of contents in context.** Each conversation's first message carries an `okfBundles` block: every bundle's path, concept counts by trust tier, stale and deprecated counts, and its root `index.md` (synthesized from frontmatter when missing). The block is rebuilt after compaction and capped by a token budget.
- **Annotated reads.** When Claude reads a concept with `Read`, a note follows the result: its trust tier (OKF §5.3), status, staleness against `stale_after`, every link resolved to an absolute path, and the concepts that link to it. Links starting with `/` are bundle-relative in OKF, so this is what keeps Claude from looking for them at the filesystem root. An Attested Computation's note says to supply only its declared parameters.
- **Frontmatter search.** `okf_search` filters concepts by words, `type`, `tags`, minimum trust tier, staleness and status. `okf_index` lists a directory with flags. Full-text search stays with Grep.
- **Mentions.** `@okf:<bundle>/<concept id>` (or `@okf:<bundle>/<dir>/` for its index) attaches the file with the same note; the prompt box completes `@okf:` by bundle, id and title.
- **Change notes.** When a bundle changes between prompts (a concept added, removed or edited, a `log.md` updated), the next prompt carries a note listing what changed and the newest `log.md` entry, so Claude knows what it read earlier may be outdated.
- **`/okf`** lists the bundles; `/okf rescan` reads them again.

## Does it help?

In a small evaluation on an 8,000-concept bundle built from MDN's Web API docs, with a few facts changed so that answers from memory are wrong ([docs/evaluation.md](docs/evaluation.md)):

- **When the request names the bundle**, Claude finds the answer with Grep and Read alone, with or without cc-okf. The plugin saves some turns but costs more per one-off question.
- **When the request does not mention the bundle** (for example "write a service worker that serves cached responses regardless of `Vary`"), Claude without any hint never looked at the bundle and answered from memory (2/8). Four lines in `CLAUDE.md` pointing at the bundles made it search every time (7/8). cc-okf's table of contents made it search when the request was related (8/8), with about 40% fewer turns and 25% lower cost than the `CLAUDE.md` lines.

Each condition ran twice, on one bundle and one model, so treat these as a direction, not a measurement.

## Install

At the prompt of a terminal session:

```
/plugin install cc-okf --marketplace yokonao/cc-okf
```

Requires Claude Code 2.1.316 or later; the plugin is a hooks module, an early-access API. CI tests it daily against 2.1.316 and the latest release.

## Add a bundle

A bundle is any directory, or link to one, directly under the bundles directory, `~/.claude/okf/` by default. Its directory name is the bundle's name. To keep bundles elsewhere, set the `bundlesDir` option or the `OKF_DIR` environment variable (for example in the `env` block of `~/.claude/settings.json`); without either, `$CLAUDE_CONFIG_DIR/okf/` is used when that is set. A leading `~` means your home directory. Inside a bundle, a link to a directory is followed only when it stays within the bundle; the scan skips any other and lists it in `/okf`.

```sh
git clone https://github.com/GoogleCloudPlatform/open-knowledge-format /tmp/okf
mkdir -p ~/.claude/okf
cp -R /tmp/okf/bundles/acme_retail ~/.claude/okf/
```

A bundle added during a session shows up in tools and `/okf` at once, and in the table of contents from the next conversation.

The table of contents shows each bundle's root `index.md`, so that file decides when Claude thinks to look. Write it to say which questions the bundle answers, close to leaf level, rather than only listing subdirectories.

## Managed machines and Team/Enterprise plans

On a machine with managed settings or a `managed-mcp.json`, or on a Team or Enterprise plan, Claude Code seats its built-in guard `cc-plugin-sec-default` first. The guard sends `prompt.context` on past user-installed plugins, so the table of contents never reaches the session. `--settings`, `enabledPlugins` and `--plugin-dir` cannot change this; only managed settings can.

Everything else keeps working: `okf_search` and `okf_index` are registered, and a `Read` inside a bundle still gets its note. The only sign is this line at session start:

```
cc-okf: its prompt.context hook was skipped. "cc-plugin-sec-default" runs first and sent the event on past it.
```

As a fallback, keep cc-okf installed, render the table of contents to a file from a checkout of this repository, and import it from `~/.claude/CLAUDE.md`, which Claude Code loads itself:

```sh
bun scripts/inspect.ts ~/.claude/okf 4000 > ~/.claude/okf-toc.md
```

```md
@~/.claude/okf-toc.md
```

- The file holds the same preamble and per-bundle sections as the hook. Its lines about `Read` notes and the MCP tools stay true while the plugin is installed.
- It goes stale. Run the command again after adding or editing concepts; trust and staleness counts are as of the last run.
- A bundle with a hand-written root `index.md` can be imported directly instead (`@~/.claude/okf/<name>/index.md`). That drops the preamble and the token budget, so it suits small bundles.

This is a fallback, not an equivalent. Against a four-line `CLAUDE.md`, the file took 0.7 fewer turns but cost $0.03 more per one-shot session ([docs/evaluation.md](docs/evaluation.md)); whether it matches the hook is not measured.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `tocBudgetTokens` | 4000 | Upper bound for the table of contents across all bundles. |
| `bundlesDir` | empty | The bundles directory. Empty falls back to `$OKF_DIR`, `$CLAUDE_CONFIG_DIR/okf`, then `~/.claude/okf`. |

Set it in `/config`, or under `pluginConfigs` in `~/.claude/settings.json`.

## Development

```sh
claude plugin validate .
claude plugin test .
npx -p typescript@5.6.3 tsc -p .   # after copying the engine's types into .claude-plugin/types/
claude --plugin-dir .              # try it in a session
```

`hooks/register.ts` connects to the engine; `lib/` holds the scanning, parsing and rendering as plain functions. `lib/vendor/` holds js-yaml, since a hooks module imports only files inside the plugin. [docs/design.md](docs/design.md) explains the choices.

`bun scripts/inspect.ts [okf dir] [budget tokens]` prints the table of contents the plugin would add. `scripts/eval/` builds the MDN bundle and runs the evaluation; see [docs/evaluation.md](docs/evaluation.md).

## License

MIT. `lib/vendor/js-yaml.mjs` is MIT (see `lib/vendor/`); `tests/fixtures/acme_retail` is Apache-2.0 (see `tests/fixtures/`).
