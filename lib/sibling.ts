// Links into sibling bundles are a cc-okf extension, not part of OKF v0.2,
// which only resolves links within a bundle (§6.1). A relative link leaving
// the bundle by one level, `../<name>/<rest>`, resolves into the bundle
// <name> found in the same bundles directory. The spec allows it: such a link
// is a relative path (§6.2) and, to a consumer without the extension, a
// broken link it must tolerate (§11). Drop this file and its callers once
// OKF defines links across bundles.
import { type Bundle, cleanTarget, resolveLinks } from './bundle'
import { dirname, join, normalize } from './paths'

const siblingsOf = new WeakMap<Bundle, readonly Bundle[]>()
/** Concept id → `<bundle>:<id>` of the concepts in other bundles linking to it. */
const backlinksOf = new WeakMap<Bundle, Map<string, string[]>>()

export function linkSiblings(bundles: readonly Bundle[]): void {
  for (const bundle of bundles) siblingsOf.set(bundle, bundles)
  for (const bundle of bundles) {
    for (const concept of bundle.concepts.values()) {
      for (const link of resolveLinks(bundle, concept)) {
        if (link.exists) continue
        const hit = resolveSibling(bundle, concept.id, link.raw)
        if (hit === undefined || !hit.rel.endsWith('.md')) continue
        const id = hit.rel.slice(0, -'.md'.length)
        if (!hit.bundle.concepts.has(id)) continue
        const byId = backlinksOf.get(hit.bundle) ?? new Map<string, string[]>()
        const from = byId.get(id) ?? []
        const ref = `${bundle.name}:${concept.id}`
        if (!from.includes(ref)) from.push(ref)
        byId.set(id, from)
        backlinksOf.set(hit.bundle, byId)
      }
    }
  }
}

/** The sibling bundle and the path within it that `target`, as written in the document `fromId`, points to. */
export function resolveSibling(bundle: Bundle, fromId: string, target: string): { bundle: Bundle; rel: string } | undefined {
  const clean = cleanTarget(target)
  if (clean === undefined || clean.startsWith('/')) return undefined
  // From the concept, then from the bundle root, as resolveRef does.
  for (const p of [normalize(join(dirname(fromId), clean)), normalize(clean)]) {
    if (!p.startsWith('../')) continue
    const rest = p.slice('../'.length)
    const slash = rest.indexOf('/')
    const name = slash < 0 ? rest : rest.slice(0, slash)
    const rel = slash < 0 ? '' : rest.slice(slash + 1)
    const other = siblingsOf.get(bundle)?.find(b => b !== bundle && b.name === name)
    if (other !== undefined && (other.files.has(rel) || other.dirs.has(rel))) return { bundle: other, rel }
  }
  return undefined
}

export function siblingBacklinks(bundle: Bundle, id: string): string[] {
  return backlinksOf.get(bundle)?.get(id) ?? []
}
