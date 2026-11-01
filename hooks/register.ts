import type { EngineInterface, Register } from 'claude-code'
import { type Bundle, type ConceptCache, type FsLike, discoverBundles, scanBundle } from '../lib/bundle.ts'
import { join, normalize, relativeTo } from '../lib/paths.ts'
import {
  indexBody,
  renderBundles,
  renderConceptNote,
  renderDirectory,
  renderIndexNote,
  renderSearch,
  renderToc,
} from '../lib/render.ts'
import { diff, fromStored, newestLogSection, renderChanges, snapshot, toStored, touchIndex } from '../lib/changes.ts'
import { resolveMention, suggestMentions } from '../lib/mention.ts'
import { search } from '../lib/search.ts'
import { TRUST_TIERS, type TrustTier } from '../lib/trust.ts'

const CONTEXT_BLOCK = 'okfBundles'
const CHARS_PER_TOKEN = 4
const RESCAN_AFTER_MS = 2000

type Scan = { okfDir: string; bundles: Bundle[]; rootIndexes: Map<string, string | undefined>; at: number }

// Module state is rebuilt on reload; the cache only saves re-reading unchanged files.
const cache: ConceptCache = new Map()
let last: Scan | undefined
let isDirty = true
let inflight: Promise<Scan> | undefined
let bundlesDir = ''
const TOLD_INDEX = 'told-index'

function fsOf($: EngineInterface): FsLike {
  return {
    exists: path => $.fs.exists(path),
    list: path => $.fs.list(path),
    read: path => $.fs.read(path),
    stat: path => $.fs.stat(path, { resolve: true }),
  }
}

/** Where bundles live: the `bundlesDir` option, then `$OKF_DIR`, then `$CLAUDE_CONFIG_DIR/okf`, then `~/.claude/okf`. */
async function okfDir($: EngineInterface): Promise<string> {
  const home = (await $.env.get('HOME')) ?? '/'
  const expand = (p: string) => (p === '~' || p.startsWith('~/') ? join(home, p.slice(1)) : normalize(p))
  const configured = bundlesDir || (await $.env.get('OKF_DIR'))
  if (configured) return expand(configured)
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  return configDir ? join(expand(configDir), 'okf') : join(home, '.claude', 'okf')
}

async function scan($: EngineInterface, force = false): Promise<Scan> {
  const now = await $.clock.now()
  if (!force && !isDirty && last !== undefined && now - last.at < RESCAN_AFTER_MS) return last
  inflight ??= (async () => {
    try {
      const fs = fsOf($)
      const dir = await okfDir($)
      const bundles: Bundle[] = []
      for (const { name, root } of await discoverBundles(fs, dir)) {
        bundles.push(await scanBundle(fs, name, root, cache))
      }
      const rootIndexes = new Map<string, string | undefined>()
      for (const b of bundles) {
        const index = b.indexes.get('')
        rootIndexes.set(b.name, index === undefined ? undefined : indexBody(await fs.read(index)))
      }
      isDirty = false
      last = { okfDir: dir, bundles, rootIndexes, at: now }
      return last
    } finally {
      inflight = undefined
    }
  })()
  return inflight
}

// What the conversation's table of contents and change notes have told the model, by session, so a
// resumed session in a new process still learns what changed while it was away.
async function readTold($: EngineInterface) {
  return fromStored(await $.store.get(`told:${await $.session.id()}`))
}

/** Best effort: a store that refuses (a bundle too large to record) costs the change notes, nothing else. */
async function writeTold($: EngineInterface, bundles: readonly Bundle[]) {
  try {
    const id = await $.session.id()
    await $.store.set(`told:${id}`, toStored(snapshot(bundles)))
    const { index, dropped } = touchIndex(await $.store.get(TOLD_INDEX), id)
    await $.store.set(TOLD_INDEX, index)
    for (const old of dropped) await $.store.delete(`told:${old}`)
  } catch {
    // The next prompt then finds no baseline and sends no change note.
  }
}

function locate(bundles: readonly Bundle[], path: string): { bundle: Bundle; rel: string } | undefined {
  for (const bundle of bundles) {
    const rel = relativeTo(bundle.root, path) ?? relativeTo(bundle.realRoot, path)
    if (rel !== undefined) return { bundle, rel }
  }
  return undefined
}

function isUnderOkf(path: string): boolean {
  if (last === undefined) return false
  return relativeTo(last.okfDir, path) !== undefined || locate(last.bundles, path) !== undefined
}

async function noteForRead($: EngineInterface, path: string): Promise<string | undefined> {
  if (!path.endsWith('.md')) return undefined
  const { bundles } = await scan($)
  const hit = locate(bundles, path)
  if (hit === undefined) return undefined
  const { bundle, rel } = hit
  if (rel === 'index.md' || rel.endsWith('/index.md')) return renderIndexNote(bundle, rel.slice(0, -'index.md'.length).replace(/\/$/, ''))
  const concept = bundle.concepts.get(rel.slice(0, -'.md'.length))
  return concept === undefined ? undefined : renderConceptNote(bundle, concept, await $.clock.now())
}

const SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Words that must all appear in the title, id, tags, description or type.' },
    bundle: { type: 'string', description: 'Limit to one bundle by name.' },
    type: { type: 'string', description: 'Exact concept type, e.g. "Metric" or "Attested Computation".' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Tags the concept must all carry.' },
    min_trust: { type: 'string', enum: TRUST_TIERS, description: 'Lowest trust tier to include.' },
    include_stale: { type: 'boolean', description: 'Include concepts past stale_after (default true).' },
    include_deprecated: { type: 'boolean', description: 'Include deprecated concepts (default false).' },
    limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum results (default 20).' },
  },
}

const INDEX_SCHEMA = {
  type: 'object',
  properties: {
    bundle: { type: 'string', description: 'Bundle name; omit to list the bundles.' },
    dir: { type: 'string', description: 'Directory relative to the bundle root; omit for the root.' },
  },
}

export const register: Register = (on, options) => {
  const budget = typeof options.tocBudgetTokens === 'number' ? options.tocBudgetTokens : 4000
  bundlesDir = typeof options.bundlesDir === 'string' ? options.bundlesDir.trim() : ''

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'okf_search',
      description:
        'Search the OKF knowledge bundles by frontmatter: words in title, id, tags, description or type, filtered by type, tags, trust tier, staleness and status. Returns concept ids, flags and absolute paths to Read.',
      inputSchema: SEARCH_SCHEMA,
      isDeferred: true,
    })
    await $.tool.register({
      name: 'okf_index',
      description:
        "List a directory of an OKF bundle: its index.md, or one synthesized from frontmatter, with flags for concepts that are not human-reviewed, stale or deprecated. With no bundle, lists the bundles.",
      inputSchema: INDEX_SCHEMA,
      isDeferred: true,
    })
    await $.command.register({ name: 'okf', description: 'List the OKF bundles cc-okf reads', argumentHint: '[rescan]' })
    return next(e)
  })

  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    const { okfDir: dir, bundles, rootIndexes } = await scan($)
    if (bundles.length === 0) return result
    // A resumed conversation still holds the table of contents it was first sent, so keep that baseline.
    if ((await readTold($)) === undefined) await writeTold($, bundles)
    const text = renderToc(bundles, rootIndexes, dir, budget * CHARS_PER_TOKEN, await $.clock.now())
    return { ...result, blocks: [...result.blocks.filter(b => b.name !== CONTEXT_BLOCK), { name: CONTEXT_BLOCK, text }] }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta === true) return next(e)
    const { bundles } = await scan($, true)
    const was = await readTold($)
    await writeTold($, bundles)
    if (was === undefined) return next(e)
    const changes = diff(was, snapshot(bundles))
    const logs = new Map<string, string | undefined>()
    for (const c of changes.changes) {
      const bundle = bundles.find(b => b.name === c.bundle)
      for (const dir of c.logs) {
        const log = bundle?.logs.get(dir)
        if (log !== undefined) logs.set(`${c.bundle}:${dir}`, newestLogSection(await $.fs.read(log.path)))
      }
    }
    const note = renderChanges(changes, logs)
    return next(note === undefined ? e : { ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => next(e))

  on('prompt.mention', async ($, e, next) => {
    const { bundles } = await scan($)
    const target = resolveMention(bundles, e.mention)
    const result = await next(target === undefined ? e : { ...e, path: target.path })
    if (result.deny !== undefined || result.type === null) return result
    const note = await noteForRead($, target?.path ?? e.path)
    return note === undefined ? result : { ...result, context: [...(result.context ?? []), note] }
  }).catch(($, e, next) => next(e))

  on('prompt.autocomplete', { token: /^@okf:/ }, async ($, e, next) => {
    const result = await next(e)
    const { bundles } = await scan($)
    return { suggestions: [...result.suggestions, ...suggestMentions(bundles, e.token, await $.clock.now())] }
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined || result.isError === true) return result
    const note = await noteForRead($, e.file_path)
    return note === undefined ? result : { ...result, context: [...(result.context ?? []), note] }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const result = await next(e)
    if (isUnderOkf(e.file_path)) isDirty = true
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const result = await next(e)
    if (isUnderOkf(e.file_path)) isDirty = true
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'mcp__cc-okf__okf_search' }, async ($, e) => {
    const args = e as unknown as Record<string, unknown>
    const { bundles } = await scan($)
    const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)
    const minTrust = str(args.min_trust)
    const hits = search(
      bundles,
      {
        query: str(args.query),
        bundle: str(args.bundle),
        type: str(args.type),
        tags: Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string') : undefined,
        minTrust: TRUST_TIERS.includes(minTrust as TrustTier) ? (minTrust as TrustTier) : undefined,
        includeStale: typeof args.include_stale === 'boolean' ? args.include_stale : undefined,
        includeDeprecated: typeof args.include_deprecated === 'boolean' ? args.include_deprecated : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      },
      await $.clock.now(),
    )
    return { result: renderSearch(hits, await $.clock.now()) }
  }).catch(() => ({ deny: 'cc-okf: okf_search failed; Grep the bundle path instead.' }))

  on('tool.call', { tool: 'mcp__cc-okf__okf_index' }, async ($, e) => {
    const args = e as unknown as Record<string, unknown>
    const { okfDir: dir, bundles } = await scan($)
    const now = await $.clock.now()
    const name = typeof args.bundle === 'string' && args.bundle !== '' ? args.bundle : undefined
    if (name === undefined) return { result: renderBundles(bundles, dir, now) }
    const bundle = bundles.find(b => b.name === name)
    if (bundle === undefined) return { result: `No bundle named "${name}". ${renderBundles(bundles, dir, now)}` }
    const dirRel = typeof args.dir === 'string' ? args.dir.replace(/^\/+|\/+$/g, '') : ''
    if (!bundle.dirs.has(dirRel)) return { result: `No directory "${dirRel}" in ${bundle.name}.` }
    const index = bundle.indexes.get(dirRel)
    const text = index === undefined ? undefined : indexBody(await $.fs.read(index))
    return { result: renderDirectory(bundle, dirRel, text, now) }
  }).catch(() => ({ deny: 'cc-okf: okf_index failed; Read the index.md files instead.' }))

  on('command.run', { command: 'okf' }, async ($, e) => {
    const { okfDir: dir, bundles } = await scan($, e.args.trim() === 'rescan')
    return { text: renderBundles(bundles, dir, await $.clock.now()) }
  })
}
