# Design

cc-okf makes Open Knowledge Format (OKF) bundles behave in Claude Code the way skills and memory do: Claude knows they exist without being told, reads them with the tools it already uses, and is warned when what it read has changed. This note records the choices behind that and the alternatives set aside.

## What skills and memory get, and the OKF counterpart

| Treatment | Skills / memory | cc-okf |
| --- | --- | --- |
| Always-present listing | skill listing; `claudeMd` and the `MEMORY.md` index | `okfBundles` context block with each bundle's root `index.md` |
| Lazy loading | the Skill tool; `Read` of a memory file | `Read` of a concept, annotated |
| Change tracking | instruction files re-sent when they change | change notes on the next prompt |
| Survives compaction | invoked skills re-attached; context re-read | the context block is recomputed |
| Explicit reference | `/name`, `@` imports | `@okf:<bundle>/<id>` with typeahead |

## Hooks used

| Hook | Use |
| --- | --- |
| `prompt.context` | Adds the `okfBundles` block to the first user message. It is recomputed after compaction and `/clear`, and does not touch the system prompt, so the prompt cache shared across sessions stays intact. |
| `tool.call` on `Read` | Appends a note after a concept's content: trust tier, status, staleness, resolved links, backlinks, and for an Attested Computation the rule to supply only its parameters. The result itself is left as is, so line numbers and `Edit` keep working. |
| `tool.call` on `Write` / `Edit` | Marks the scan stale when a bundle file changes. |
| `$.tool.register` | `okf_search` and `okf_index`, deferred behind ToolSearch (see below). |
| `prompt.submit` | Compares the bundles with what this session was last told and attaches a change note. |
| `prompt.mention`, `prompt.autocomplete` | Resolve and complete `@okf:` mentions. |
| `$.command.register` | `/okf`. |
| `$.store` | The per-session baseline for change notes. |

## Choices

**The table of contents is data, not instructions.** It goes in its own context block rather than among the `claudeMd` instruction files, which the engine frames as instructions to follow. A bundle can come from anywhere, so the block opens by saying its content is reference data.

**Reads are the main path, not tools.** Claude already reads files well, and other OKF integrations reported that skills plus `Read` were enough. cc-okf adds only what `Read` and `Grep` cannot give: the trust tier and staleness computed from frontmatter, bundle-relative links (`/tables/orders.md`) resolved to real paths, and backlinks. The two tools cover filtering by frontmatter and directory listings with flags.

**Tools are deferred behind ToolSearch.** Listing them in the prompt changed the tool list and missed the prompt cache shared across sessions; deferred, the per-session cost fell below the baseline in evaluation.

**Links resolve from the concept, then from the bundle root.** OKF §6 says relative links are relative to the concept, but producers, Google's samples included, often write paths from the bundle root. cc-okf takes whichever exists.

**One language, no CLI.** The plugin is a TypeScript hooks module alone, so installing it is one `/plugin install` line. A hooks module imports only files inside the plugin, so js-yaml 4.1.0 is vendored; it parses with the core schema so timestamps stay strings.

**Bundles live in `~/.claude/okf/<name>/` by default**, mirroring `~/.claude/skills/<name>/`. A link to a directory counts. OKF is not tied to one tool, so the `bundlesDir` option or `$OKF_DIR` can point elsewhere (say `~/.okf`), where other agents can read the same bundles. There is no project scope yet.

**Read-only.** Writing and curating bundles is the producers' job. cc-okf only keeps its own view fresh after an edit.

**Change notes are best effort.** The baseline of what a session was told is kept per session in the plugin store, so a session resumed in a new process still gets a note. A store write that fails (a very large bundle) costs the note, never the table of contents.

## Budgets and limits

- The table of contents is capped at `tocBudgetTokens` (4,000 by default, at about 4 characters per token). When the bundle headers alone do not fit, it lists bundles by name and path instead.
- A bundle scan stops at 20,000 files. An 8,000-concept bundle scans in well under a second.

## Not done

- Executing Attested Computations and running their attesters.
- Refusing an agent's write of `verified: human:…`, which would forge a trust tier.
- A pane for browsing bundles.
