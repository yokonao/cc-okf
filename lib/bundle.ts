import { parseFrontmatter } from './frontmatter'
import { basename, dirname, join, normalize, relativeTo } from './paths'
import { type TrustTier, type Verification, trustTier, verifications } from './trust'

export type FsKind = 'file' | 'dir' | 'other'

/** The part of `$.fs` a scan needs, so lib code runs without the engine. */
export type FsLike = {
  exists(path: string): Promise<boolean>
  list(path: string): Promise<readonly { name: string; kind: FsKind; mtimeMs: number; isLink: boolean }[]>
  read(path: string): Promise<string>
  /** Follows links; `realPath` is where the path lands. */
  stat(path: string): Promise<{ kind: FsKind; mtimeMs: number; realPath?: string }>
}

export type Parameter = { name: string; type?: string; required?: boolean }

export type Concept = {
  /** OKF §2: the path within the bundle without `.md`. */
  id: string
  path: string
  mtimeMs: number
  type?: string
  title: string
  description?: string
  tags: string[]
  /** OKF §5.4: absent means `stable`. */
  status: string
  staleAfter?: string
  verified: Verification[]
  trust: TrustTier
  generated?: { by: string; at?: string }
  runtime?: string
  parameters: Parameter[]
  /** Path-valued frontmatter fields by name, for Attested Computations. */
  pathFields: Record<string, string>
  /** Link targets as written: body links first, then path-valued frontmatter. */
  refs: string[]
  problem?: string
}

export type ResolvedLink = { raw: string; rel?: string; exists: boolean }

export type Bundle = {
  name: string
  root: string
  realRoot: string
  okfVersion?: string
  concepts: Map<string, Concept>
  /** Every file's path within the bundle, concept or not. */
  files: Set<string>
  /** Every directory's path within the bundle; '' is the root. */
  dirs: Set<string>
  /** Directory path within the bundle → its index.md's absolute path. */
  indexes: Map<string, string>
  /** Directory path within the bundle → its log.md. */
  logs: Map<string, { path: string; mtimeMs: number }>
  backlinks: Map<string, string[]>
  /** Entries the scan could not take in, with why; the rest of the bundle is still scanned. */
  skipped: { rel: string; reason: string }[]
  isTruncated: boolean
}

export type ConceptCache = Map<string, Concept>

const SKIPPED_DIRS = new Set(['node_modules'])

/** Bundles are the directories, or links to directories, directly under `okfDir`. */
export async function discoverBundles(fs: FsLike, okfDir: string): Promise<{ name: string; root: string }[]> {
  if (!(await fs.exists(okfDir))) return []
  const found: { name: string; root: string }[] = []
  for (const entry of await fs.list(okfDir)) {
    if (entry.name.startsWith('.')) continue
    const root = join(okfDir, entry.name)
    const kind = entry.isLink ? await fs.stat(root).then(s => s.kind, () => 'other' as const) : entry.kind
    if (kind === 'dir') found.push({ name: entry.name, root })
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

export async function scanBundle(
  fs: FsLike,
  name: string,
  root: string,
  cache: ConceptCache,
  maxFiles = 20000,
): Promise<Bundle> {
  const realRoot = (await fs.stat(root)).realPath ?? root
  const bundle: Bundle = {
    name,
    root,
    realRoot,
    concepts: new Map(),
    files: new Set(),
    dirs: new Set(['']),
    indexes: new Map(),
    logs: new Map(),
    backlinks: new Map(),
    skipped: [],
    isTruncated: false,
  }
  const skip = (rel: string, error: unknown) =>
    bundle.skipped.push({ rel, reason: error instanceof Error ? error.message : String(error) })
  // Real paths of the directories walked, so a link back into the tree is not walked again.
  const walked = new Set([realRoot])

  const walk = async (dirRel: string, realDir: string): Promise<void> => {
    for (const entry of await fs.list(join(root, dirRel))) {
      if (bundle.isTruncated) return
      if (entry.name.startsWith('.')) continue
      const rel = dirRel === '' ? entry.name : `${dirRel}/${entry.name}`
      try {
        await take(entry, dirRel, rel, realDir)
      } catch (error) {
        skip(rel, error)
      }
    }
  }

  const take = async (
    entry: { name: string; kind: FsKind; mtimeMs: number; isLink: boolean },
    dirRel: string,
    rel: string,
    realDir: string,
  ): Promise<void> => {
    const path = join(root, rel)
    let { kind, mtimeMs } = entry
    let realPath = join(realDir, entry.name)
    if (entry.isLink) {
      const target = await fs.stat(path)
      ;({ kind, mtimeMs } = target)
      realPath = target.realPath ?? realPath
    }

    if (kind === 'dir') {
      if (SKIPPED_DIRS.has(entry.name)) return
      if (relativeTo(realRoot, realPath) === undefined) throw new Error(`links to ${realPath}, outside the bundle`)
      if (walked.has(realPath)) throw new Error(`${realPath} is already walked through another path`)
      walked.add(realPath)
      bundle.dirs.add(rel)
      await walk(rel, realPath)
      return
    }
    if (kind !== 'file') return
    if (bundle.files.size >= maxFiles) {
      bundle.isTruncated = true
      return
    }
    bundle.files.add(rel)
    if (!rel.endsWith('.md')) return
    if (entry.name === 'index.md') {
      bundle.indexes.set(dirRel, path)
      return
    }
    if (entry.name === 'log.md') {
      bundle.logs.set(dirRel, { path, mtimeMs })
      return
    }

    const cached = cache.get(path)
    const concept =
      cached !== undefined && cached.mtimeMs === mtimeMs
        ? cached
        : parseConcept(rel.slice(0, -'.md'.length), path, mtimeMs, await fs.read(path))
    cache.set(path, concept)
    bundle.concepts.set(concept.id, concept)
  }
  await walk('', realRoot)

  const rootIndex = bundle.indexes.get('')
  if (rootIndex !== undefined) {
    try {
      const version = parseFrontmatter(await fs.read(rootIndex)).data.okf_version
      if (version != null) bundle.okfVersion = String(version)
    } catch (error) {
      skip('index.md', error)
    }
  }

  for (const concept of bundle.concepts.values()) {
    for (const link of resolveLinks(bundle, concept)) {
      if (link.rel === undefined || !link.rel.endsWith('.md')) continue
      const target = link.rel.slice(0, -'.md'.length)
      if (target === concept.id || !bundle.concepts.has(target)) continue
      const from = bundle.backlinks.get(target) ?? []
      if (!from.includes(concept.id)) from.push(concept.id)
      bundle.backlinks.set(target, from)
    }
  }
  return bundle
}

const PATH_FIELDS = ['resource', 'computation', 'executor.resource', 'attester.resource'] as const

export function parseConcept(id: string, path: string, mtimeMs: number, text: string): Concept {
  const { data, body, problem } = parseFrontmatter(text)
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)
  const type = str(data.type)
  const verified = verifications(data.verified)
  const generated = data.generated as Record<string, unknown> | undefined
  const generatedBy = generated != null && typeof generated === 'object' ? str(generated.by) : undefined

  const pathFields: Record<string, string> = {}
  for (const field of PATH_FIELDS) {
    const [head, tail] = field.split('.') as [string, string | undefined]
    const owner = tail === undefined ? data : (data[head] as Record<string, unknown> | undefined)
    const value = owner != null && typeof owner === 'object' ? str(owner[tail ?? head]) : undefined
    if (value !== undefined) pathFields[field] = value
  }
  const sources = Array.isArray(data.sources) ? data.sources : []
  const sourceRefs = sources.flatMap(s => {
    const resource = s != null && typeof s === 'object' ? str((s as Record<string, unknown>).resource) : undefined
    return resource === undefined ? [] : [resource]
  })

  return {
    id,
    path,
    mtimeMs,
    type,
    title: str(data.title) ?? basename(id),
    description: str(data.description),
    tags: toStrings(data.tags),
    status: str(data.status) ?? 'stable',
    staleAfter: str(data.stale_after),
    verified,
    trust: trustTier(verified),
    generated: generatedBy === undefined ? undefined : { by: generatedBy, at: str(generated?.at) },
    runtime: str(data.runtime),
    parameters: toParameters(data.parameters),
    pathFields,
    refs: unique([...bodyLinks(body), ...sourceRefs, ...Object.values(pathFields)]),
    problem: problem ?? (type === undefined ? 'frontmatter lacks the required `type`' : undefined),
  }
}

/** A path within the bundle for `target` as written in the concept `fromId`, or undefined when external. */
export function resolveRef(bundle: Bundle, fromId: string, target: string): { rel?: string; exists: boolean } {
  const clean = cleanTarget(target)
  if (clean === undefined) return { exists: false }
  const exists = (rel: string) => bundle.files.has(rel) || bundle.dirs.has(rel)

  if (clean.startsWith('/')) {
    const rel = normalize(clean).slice(1)
    return { rel, exists: exists(rel) }
  }
  // OKF §6 says relative to the concept, yet producers often write paths from the bundle root.
  const fromDir = normalize(join(dirname(fromId), clean))
  if (exists(fromDir)) return { rel: fromDir, exists: true }
  const fromRoot = normalize(clean)
  if (!fromRoot.startsWith('..') && exists(fromRoot)) return { rel: fromRoot, exists: true }
  return fromDir.startsWith('..') ? { exists: false } : { rel: fromDir, exists: false }
}

export function resolveLinks(bundle: Bundle, concept: Concept): ResolvedLink[] {
  return concept.refs.flatMap(raw => {
    if (isExternal(raw)) return []
    return [{ raw, ...resolveRef(bundle, concept.id, raw) }]
  })
}

/** `target` as a path without its fragment and query, or undefined when external, empty or malformed. */
export function cleanTarget(target: string): string | undefined {
  if (isExternal(target)) return undefined
  const clean = decodeTarget(target.split('#')[0]?.split('?')[0] ?? '')
  return clean === '' ? undefined : clean
}

/** undefined for a malformed escape such as a bare `%`. */
function decodeTarget(target: string): string | undefined {
  try {
    return decodeURI(target)
  } catch {
    return undefined
  }
}

export function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('#')
}

const FENCE = /^(```|~~~)[\s\S]*?^\1/gm
const LINK = /(!?)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g

function bodyLinks(body: string): string[] {
  const prose = body.replace(FENCE, '')
  const out: string[] = []
  for (const m of prose.matchAll(LINK)) {
    if (m[1] === '!' || m[2] === undefined) continue
    out.push(m[2])
  }
  return out
}

function toStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function toParameters(value: unknown): Parameter[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (item == null || typeof item !== 'object') return []
    const { name, type, required } = item as Record<string, unknown>
    if (typeof name !== 'string') return []
    return [{ name, type: typeof type === 'string' ? type : undefined, required: required === true }]
  })
}

function unique(items: string[]): string[] {
  return [...new Set(items)]
}
