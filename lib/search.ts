import type { Bundle, Concept } from './bundle.ts'
import { type TrustTier, isStale, trustRank } from './trust.ts'

export type SearchQuery = {
  query?: string
  bundle?: string
  type?: string
  tags?: readonly string[]
  minTrust?: TrustTier
  includeStale?: boolean
  includeDeprecated?: boolean
  limit?: number
}

export type SearchHit = { bundle: Bundle; concept: Concept; score: number }

/** Every query word must match the concept's metadata; the body is Grep's job. */
export function search(bundles: readonly Bundle[], q: SearchQuery, now: number): SearchHit[] {
  const terms = (q.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const wantTags = (q.tags ?? []).map(t => t.toLowerCase())
  const hits: SearchHit[] = []

  for (const bundle of bundles) {
    if (q.bundle !== undefined && bundle.name !== q.bundle) continue
    for (const concept of bundle.concepts.values()) {
      if (q.type !== undefined && concept.type?.toLowerCase() !== q.type.toLowerCase()) continue
      const tags = concept.tags.map(t => t.toLowerCase())
      if (!wantTags.every(t => tags.includes(t))) continue
      if (q.minTrust !== undefined && trustRank(concept.trust) < trustRank(q.minTrust)) continue
      if (q.includeStale === false && isStale(concept.staleAfter, now)) continue
      if (q.includeDeprecated !== true && concept.status === 'deprecated') continue

      const score = scoreConcept(concept, tags, terms)
      if (score !== undefined) hits.push({ bundle, concept, score })
    }
  }

  return hits
    .sort(
      (a, b) =>
        b.score - a.score ||
        trustRank(b.concept.trust) - trustRank(a.concept.trust) ||
        `${a.bundle.name}:${a.concept.id}`.localeCompare(`${b.bundle.name}:${b.concept.id}`),
    )
    .slice(0, q.limit ?? 20)
}

function scoreConcept(concept: Concept, tags: readonly string[], terms: readonly string[]): number | undefined {
  const title = concept.title.toLowerCase()
  const id = concept.id.toLowerCase()
  const description = concept.description?.toLowerCase() ?? ''
  const type = concept.type?.toLowerCase() ?? ''
  let score = 0
  for (const term of terms) {
    const s =
      (title.includes(term) ? 3 : 0) +
      (id.includes(term) ? 2 : 0) +
      (tags.some(t => t.includes(term)) ? 2 : 0) +
      (description.includes(term) ? 1 : 0) +
      (type.includes(term) ? 1 : 0)
    if (s === 0) return undefined
    score += s
  }
  return score
}
