import type { FsKind, FsLike } from '../lib/bundle'
import { normalize, relativeTo } from '../lib/paths'

export type MemTree = { files: Record<string, string>; links?: Record<string, string>; mtimeMs?: Record<string, number> }

/** An in-memory FsLike: directories are implied by file paths; `links` maps a link path to its target. */
export function memfs(tree: MemTree): FsLike & { entries(path: string): ReturnType<FsLike['list']> } {
  const links = tree.links ?? {}
  const resolve = (p: string): string => {
    let path = normalize(p)
    for (const [link, target] of Object.entries(links)) {
      const rel = relativeTo(link, path)
      if (rel !== undefined) path = normalize(`${target}/${rel}`)
    }
    return path
  }
  const kindOf = (p: string): FsKind | undefined => {
    const path = resolve(p)
    if (path in tree.files) return 'file'
    const holds = (p: string) => relativeTo(path, p) !== undefined
    return Object.keys(tree.files).some(holds) || Object.keys(links).some(holds) ? 'dir' : undefined
  }
  const mtime = (p: string) => tree.mtimeMs?.[resolve(p)] ?? 1

  const list = async (p: string) => {
    const dir = resolve(p)
    if (kindOf(dir) !== 'dir') throw new Error(`ENOTDIR: ${p}`)
    const names = new Set<string>()
    for (const f of Object.keys(tree.files)) {
      const rel = relativeTo(dir, f)
      if (rel) names.add(rel.split('/')[0]!)
    }
    for (const link of Object.keys(links)) {
      const rel = relativeTo(normalize(p), link)
      if (rel && !rel.includes('/')) names.add(rel)
    }
    return [...names].sort().map(name => {
      const child = `${normalize(p)}/${name}`
      const isLink = normalize(child) in links
      const kind = isLink ? ('other' as const) : (kindOf(child) ?? ('other' as const))
      return { name, kind, isLink, mtimeMs: kind === 'file' ? mtime(child) : 0 }
    })
  }

  return {
    exists: async p => kindOf(p) !== undefined,
    list,
    entries: list,
    read: async p => {
      const text = tree.files[resolve(p)]
      if (text === undefined) throw new Error(`ENOENT: ${p}`)
      return text
    },
    stat: async p => {
      const kind = kindOf(p)
      if (kind === undefined) throw new Error(`ENOENT: ${p}`)
      return { kind, mtimeMs: kind === 'file' ? mtime(p) : 0, realPath: resolve(p) }
    },
  }
}

export const NOW = Date.parse('2026-10-31T00:00:00Z')

/** A small bundle that exercises every flag cc-okf reports. */
export const SHOP: Record<string, string> = {
  'index.md': '---\nokf_version: "0.2"\n---\n# Areas\n\n* [metrics](metrics/) - Headline numbers.\n',
  'log.md': '# Log\n\n## 2026-07-01\n* **Update**: revenue.\n',
  'metrics/revenue.md': `---
type: Metric
title: Revenue
description: Recognized revenue for a fiscal year.
tags: [finance, revenue]
verified:
  - { by: human:ana, at: 2026-07-01T09:00:00Z }
stale_after: 2026-09-30T00:00:00Z
sources:
  - id: policy
    resource: policies/recognition.md
---
# Definition

Computed by [the computation](../computations/revenue.md); see the [orders table](/tables/orders.md)
and [a missing page](/nowhere.md) or [the web](https://example.com).

\`\`\`md
[not a link](/ignored.md)
\`\`\`
`,
  'metrics/legacy.md': '---\ntype: Metric\ntitle: Legacy revenue\nstatus: deprecated\nverified: { by: process:nightly, at: 2026-01-01T00:00:00Z }\n---\nOld.\n',
  'computations/revenue.md': `---
type: Attested Computation
title: Revenue for a fiscal year
runtime: bigquery
parameters:
  - { name: year, type: integer, required: true }
executor:
  resource: skills/run.md
attester:
  resource: attesters/check.py
---
# Computation

    SELECT 1
`,
  'policies/recognition.md': '---\ntype: Policy\ntitle: Recognition policy\n---\nSee [revenue](/metrics/revenue.md).\n',
  'tables/orders.md': '---\ntitle: Orders\n---\nNo type here.\n',
  'skills/run.md': '---\ntype: Skill\n---\nRun it.\n',
  'attesters/check.py': 'print("ok")\n',
}

export function shopTree(root: string): Record<string, string> {
  return Object.fromEntries(Object.entries(SHOP).map(([rel, text]) => [`${root}/${rel}`, text]))
}
