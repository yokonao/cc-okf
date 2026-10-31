import type { Bundle } from './bundle.ts'
import { parseFrontmatter } from './frontmatter.ts'

/** What the model was last told about each bundle: concept and log.md mtimes. */
export type Snapshot = Map<string, { concepts: Map<string, number>; logs: Map<string, number> }>

export type BundleChange = {
  bundle: string
  added: string[]
  removed: string[]
  changed: string[]
  /** Directory paths within the bundle whose log.md changed or appeared. */
  logs: string[]
}

export function snapshot(bundles: readonly Bundle[]): Snapshot {
  return new Map(
    bundles.map(b => [
      b.name,
      {
        concepts: new Map([...b.concepts.values()].map(c => [c.id, c.mtimeMs])),
        logs: new Map([...b.logs].map(([dir, log]) => [dir, log.mtimeMs])),
      },
    ]),
  )
}

export function diff(prev: Snapshot, next: Snapshot): { changes: BundleChange[]; removedBundles: string[] } {
  const changes: BundleChange[] = []
  for (const [name, now] of next) {
    const was = prev.get(name)
    const before = was?.concepts ?? new Map<string, number>()
    const change: BundleChange = {
      bundle: name,
      added: [...now.concepts.keys()].filter(id => !before.has(id)),
      removed: [...before.keys()].filter(id => !now.concepts.has(id)),
      changed: [...now.concepts].filter(([id, t]) => before.has(id) && before.get(id) !== t).map(([id]) => id),
      logs: [...now.logs].filter(([dir, t]) => was?.logs.get(dir) !== t).map(([dir]) => dir),
    }
    if (change.added.length + change.removed.length + change.changed.length + change.logs.length > 0) changes.push(change)
  }
  return { changes, removedBundles: [...prev.keys()].filter(name => !next.has(name)) }
}

/** OKF §9: the newest date section of a log.md (newest first), heading included. */
export function newestLogSection(text: string): string | undefined {
  const { body } = parseFrontmatter(text)
  const m = /^## \d{4}-\d{2}-\d{2}.*$/m.exec(body)
  if (!m) return undefined
  const rest = body.slice(m.index + m[0].length)
  const end = rest.search(/^## /m)
  return `${m[0]}${end < 0 ? rest : rest.slice(0, end)}`.trim()
}

const MAX_IDS = 15
const MAX_LOG_CHARS = 1500

export function renderChanges(
  result: ReturnType<typeof diff>,
  newestLogs: ReadonlyMap<string, string | undefined>,
): string | undefined {
  const { changes, removedBundles } = result
  if (changes.length === 0 && removedBundles.length === 0) return undefined
  const ids = (label: string, list: string[]) =>
    list.length === 0
      ? []
      : [`${label}: ${list.slice(0, MAX_IDS).join(', ')}${list.length > MAX_IDS ? `, … ${list.length - MAX_IDS} more` : ''}`]

  const lines = ['cc-okf: OKF bundles changed since you last saw them; concepts you read before may be outdated.']
  for (const name of removedBundles) lines.push(`- ${name}: removed`)
  for (const c of changes) {
    lines.push(`- ${c.bundle}:`, ...[...ids('added', c.added), ...ids('removed', c.removed), ...ids('changed', c.changed)].map(l => `  ${l}`))
    for (const dir of c.logs) {
      const section = newestLogs.get(`${c.bundle}:${dir}`)
      if (section === undefined) continue
      const clipped = section.length > MAX_LOG_CHARS ? `${section.slice(0, MAX_LOG_CHARS)}…` : section
      lines.push(`  newest entry of /${dir === '' ? '' : `${dir}/`}log.md:`, ...clipped.split('\n').map(l => `    ${l}`))
    }
  }
  return lines.join('\n')
}

export type StoredSnapshot = Record<string, { concepts: [string, number][]; logs: [string, number][] }>

/** How many sessions keep a stored snapshot; each lives under its own store key. */
export const KEPT_SESSIONS = 20

export function toStored(snap: Snapshot): StoredSnapshot {
  return Object.fromEntries([...snap].map(([name, s]) => [name, { concepts: [...s.concepts], logs: [...s.logs] }]))
}

export function fromStored(stored: unknown): Snapshot | undefined {
  if (stored == null || typeof stored !== 'object') return undefined
  const out: Snapshot = new Map()
  for (const [name, s] of Object.entries(stored as StoredSnapshot)) {
    if (!Array.isArray(s?.concepts) || !Array.isArray(s?.logs)) return undefined
    out.set(name, { concepts: new Map(s.concepts), logs: new Map(s.logs) })
  }
  return out
}

/** The session index after `sessionId` is written: newest last, and the ids that fell off. */
export function touchIndex(index: unknown, sessionId: string): { index: string[]; dropped: string[] } {
  const ids = Array.isArray(index) ? index.filter((x): x is string => typeof x === 'string' && x !== sessionId) : []
  const next = [...ids, sessionId]
  const cut = Math.max(0, next.length - KEPT_SESSIONS)
  return { index: next.slice(cut), dropped: next.slice(0, cut) }
}
