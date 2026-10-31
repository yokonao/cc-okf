import type { Bundle } from './bundle.ts'
import { flags } from './render.ts'

export const MENTION_PREFIX = 'okf:'

/** The file an `@okf:<bundle>/<concept id or dir>` mention names; `.md` and a trailing slash are optional. */
export function resolveMention(bundles: readonly Bundle[], mention: string): { bundle: Bundle; path: string } | undefined {
  if (!mention.startsWith(MENTION_PREFIX)) return undefined
  const spec = mention.slice(MENTION_PREFIX.length).split('#')[0] ?? ''
  const slash = spec.indexOf('/')
  const name = slash < 0 ? spec : spec.slice(0, slash)
  const rest = (slash < 0 ? '' : spec.slice(slash + 1)).replace(/\/+$/, '').replace(/\.md$/, '')
  const bundle = bundles.find(b => b.name === name)
  if (bundle === undefined) return undefined

  const concept = bundle.concepts.get(rest)
  if (concept !== undefined) return { bundle, path: concept.path }
  const index = bundle.indexes.get(rest)
  if (index !== undefined) return { bundle, path: index }
  return undefined
}

export type Suggestion = { text: string; label: string; description?: string }

/** Typeahead rows for a token starting `@okf:`, bundles first, then concepts whose id or title matches. */
export function suggestMentions(bundles: readonly Bundle[], token: string, now: number, limit = 20): Suggestion[] {
  if (!token.startsWith(`@${MENTION_PREFIX}`)) return []
  const typed = token.slice(1 + MENTION_PREFIX.length).toLowerCase()
  const out: Suggestion[] = []

  if (!typed.includes('/')) {
    for (const b of bundles) {
      if (b.name.toLowerCase().startsWith(typed)) {
        out.push({ text: `@${MENTION_PREFIX}${b.name}/`, label: `${MENTION_PREFIX}${b.name}/`, description: `${b.concepts.size} concepts` })
      }
    }
  }
  for (const b of bundles) {
    for (const c of b.concepts.values()) {
      const key = `${b.name}/${c.id}`.toLowerCase()
      const matches = typed.includes('/') ? key.startsWith(typed) || key.includes(typed) : c.title.toLowerCase().includes(typed) || key.includes(typed)
      if (!matches) continue
      out.push({
        text: `@${MENTION_PREFIX}${b.name}/${c.id}`,
        label: `${MENTION_PREFIX}${b.name}/${c.id}`,
        description: `${c.title} · ${[c.type ?? 'no type', ...flags(c, now)].join(' · ')}`,
      })
      if (out.length >= limit) return out
    }
  }
  return out.slice(0, limit)
}
