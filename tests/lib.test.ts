import { describe, expect, test } from 'claude-code/testing'
import { discoverBundles, parseConcept, resolveLinks, scanBundle } from '../lib/bundle.ts'
import { parseFrontmatter } from '../lib/frontmatter.ts'
import { normalize, relativeTo } from '../lib/paths.ts'
import { renderConceptNote, renderDirectory, renderToc, synthesizeIndex } from '../lib/render.ts'
import { search } from '../lib/search.ts'
import { isStale, trustTier, verifications } from '../lib/trust.ts'
import { NOW, memfs, shopTree } from './memfs.ts'

const ROOT = '/home/u/.claude/okf/shop'

async function shop() {
  return scanBundle(memfs({ files: shopTree(ROOT) }), 'shop', ROOT, new Map())
}

describe('paths', () => {
  test('normalize folds dots and keeps absolute', () => {
    expect(normalize('/a/./b/../c/')).toBe('/a/c')
    expect(normalize('a/../../b')).toBe('../b')
    expect(relativeTo('/a/b', '/a/b/c/d.md')).toBe('c/d.md')
    expect(relativeTo('/a/b', '/a/bc')).toBeUndefined()
  })
})

describe('frontmatter', () => {
  test('timestamps stay strings', () => {
    const { data } = parseFrontmatter('---\ngenerated: { by: x/1, at: 2026-06-20T22:53:05Z }\n---\nbody')
    expect((data.generated as { at: unknown }).at).toBe('2026-06-20T22:53:05Z')
  })
  test('missing, empty and broken blocks', () => {
    expect(parseFrontmatter('# Title').problem).toBe('no frontmatter block')
    expect(parseFrontmatter('---\n---\nbody')).toEqual({ data: {}, body: 'body' })
    expect(parseFrontmatter('---\na: [\n---\n').problem).toMatch(/not valid YAML/)
  })
})

describe('trust', () => {
  test('tiers follow OKF §5.3, a bare mapping counts as a list', () => {
    expect(trustTier(verifications(undefined))).toBe('unverified')
    expect(trustTier(verifications({ by: 'process:n' }))).toBe('machine-confirmed')
    expect(trustTier(verifications([{ by: 'process:n' }, { by: 'human:a' }]))).toBe('human-reviewed')
  })
  test('stale once now reaches stale_after', () => {
    expect(isStale('2026-10-31T00:00:00Z', NOW)).toBe(true)
    expect(isStale('2026-11-01T00:00:00Z', NOW)).toBe(false)
    expect(isStale('not a date', NOW)).toBe(false)
  })
})

describe('scan', () => {
  test('reserved files are not concepts, a missing type is flagged', async () => {
    const b = await shop()
    expect([...b.concepts.keys()].sort()).toEqual([
      'computations/revenue',
      'metrics/legacy',
      'metrics/revenue',
      'policies/recognition',
      'skills/run',
      'tables/orders',
    ])
    expect(b.okfVersion).toBe('0.2')
    expect(b.concepts.get('tables/orders')?.problem).toMatch(/type/)
    expect(b.concepts.get('metrics/legacy')?.trust).toBe('machine-confirmed')
  })

  test('links resolve from the concept, then from the bundle root; fences are skipped', async () => {
    const b = await shop()
    const links = resolveLinks(b, b.concepts.get('metrics/revenue')!)
    expect(links).toEqual([
      { raw: '../computations/revenue.md', rel: 'computations/revenue.md', exists: true },
      { raw: '/tables/orders.md', rel: 'tables/orders.md', exists: true },
      { raw: '/nowhere.md', rel: 'nowhere.md', exists: false },
      { raw: 'policies/recognition.md', rel: 'policies/recognition.md', exists: true },
    ])
    expect(b.backlinks.get('metrics/revenue')).toEqual(['policies/recognition'])
  })

  test('unchanged files come from the cache', async () => {
    const files = shopTree(ROOT)
    const cache = new Map()
    await scanBundle(memfs({ files }), 'shop', ROOT, cache)
    files[`${ROOT}/metrics/revenue.md`] = '---\ntype: Changed\n---\n'
    const same = await scanBundle(memfs({ files }), 'shop', ROOT, cache)
    expect(same.concepts.get('metrics/revenue')?.type).toBe('Metric')
    const fresh = await scanBundle(memfs({ files, mtimeMs: { [`${ROOT}/metrics/revenue.md`]: 2 } }), 'shop', ROOT, cache)
    expect(fresh.concepts.get('metrics/revenue')?.type).toBe('Changed')
  })

  test('bundles are directories or links to them under the okf dir', async () => {
    const fs = memfs({
      files: { ...shopTree('/data/shop'), '/home/u/.claude/okf/notes.txt': 'x', '/home/u/.claude/okf/.hidden/a.md': '' },
      links: { '/home/u/.claude/okf/shop': '/data/shop' },
    })
    const found = await discoverBundles(fs, '/home/u/.claude/okf')
    expect(found).toEqual([{ name: 'shop', root: '/home/u/.claude/okf/shop' }])
    const b = await scanBundle(fs, 'shop', found[0]!.root, new Map())
    expect(b.realRoot).toBe('/data/shop')
    expect(b.concepts.size).toBe(6)
    expect(await discoverBundles(fs, '/nowhere')).toEqual([])
  })
})

describe('scan survives bad entries', () => {
  test('a dangling link, a bare % and a link cycle are skipped, the rest is scanned', async () => {
    const files = { ...shopTree(ROOT), [`${ROOT}/pct.md`]: '---\ntype: Note\n---\nsee [half](50%.md)\n' }
    const links = { [`${ROOT}/dangling`]: '/nonexistent', [`${ROOT}/metrics/loop`]: ROOT }
    const b = await scanBundle(memfs({ files, links }), 'shop', ROOT, new Map())
    expect(b.concepts.size).toBe(7)
    expect(resolveLinks(b, b.concepts.get('pct')!)).toEqual([{ raw: '50%.md', exists: false }])
    expect(b.skipped.map(s => s.rel)).toEqual(['dangling', 'metrics/loop'])
    expect(b.skipped[0]!.reason).toMatch(/ENOENT/)
    expect(b.skipped[1]!.reason).toMatch(/already walked/)
  })

  test('a directory link leaving the bundle is not followed', async () => {
    const files = { ...shopTree(ROOT), '/home/u/diary.md': '---\ntype: Note\n---\nprivate\n' }
    const b = await scanBundle(memfs({ files, links: { [`${ROOT}/notes`]: '/home/u' } }), 'shop', ROOT, new Map())
    expect(b.concepts.size).toBe(6)
    expect(b.dirs.has('notes')).toBe(false)
    expect(b.skipped).toEqual([{ rel: 'notes', reason: 'links to /home/u, outside the bundle' }])
  })

  test('a dangling link among bundles is not a bundle', async () => {
    const fs = memfs({ files: shopTree('/okf/shop'), links: { '/okf/gone': '/nonexistent' } })
    expect(await discoverBundles(fs, '/okf')).toEqual([{ name: 'shop', root: '/okf/shop' }])
  })
})

describe('search', () => {
  test('all words must match; deprecated is left out unless asked', async () => {
    const b = await shop()
    expect(search([b], { query: 'revenue' }, NOW).map(h => h.concept.id)).toEqual([
      'metrics/revenue',
      'computations/revenue',
    ])
    expect(search([b], { query: 'revenue', includeDeprecated: true }, NOW).map(h => h.concept.id)).toContain('metrics/legacy')
    expect(search([b], { query: 'revenue nope' }, NOW)).toEqual([])
  })
  test('filters by type, tags, trust and staleness', async () => {
    const b = await shop()
    expect(search([b], { type: 'metric' }, NOW).map(h => h.concept.id)).toEqual(['metrics/revenue'])
    expect(search([b], { tags: ['finance'] }, NOW).map(h => h.concept.id)).toEqual(['metrics/revenue'])
    expect(search([b], { minTrust: 'human-reviewed' }, NOW).map(h => h.concept.id)).toEqual(['metrics/revenue'])
    expect(search([b], { type: 'Metric', includeStale: false }, NOW)).toEqual([])
  })
})

describe('render', () => {
  test('the concept note carries trust, staleness and resolved links', async () => {
    const b = await shop()
    const note = renderConceptNote(b, b.concepts.get('metrics/revenue')!, NOW)
    expect(note).toContain('cc-okf: OKF concept shop:metrics/revenue')
    expect(note).toContain('trust: human-reviewed (human:ana 2026-07-01T09:00:00Z)')
    expect(note).toContain('Stale since 2026-09-30T00:00:00Z')
    expect(note).toContain(`- /tables/orders.md → ${ROOT}/tables/orders.md`)
    expect(note).toContain(`- /nowhere.md → ${ROOT}/nowhere.md (not in the bundle)`)
    expect(note).toContain('Referenced by: policies/recognition')
  })

  test('an Attested Computation names its parameters and the files it points at', async () => {
    const b = await shop()
    const note = renderConceptNote(b, b.concepts.get('computations/revenue')!, NOW)
    expect(note).toContain('supply values only for the declared parameters (year: integer (required))')
    expect(note).toContain(`executor.resource: ${ROOT}/skills/run.md`)
    expect(note).toContain(`attester.resource: ${ROOT}/attesters/check.py`)
  })

  test('the table of contents stays within its budget', async () => {
    const b = await shop()
    const full = renderToc([b], new Map([['shop', undefined]]), '/okf', 100_000, NOW)
    expect(full).toContain('## shop')
    expect(full).toContain('* [metrics](metrics/) - 2 concepts')
    const small = renderToc([b], new Map([['shop', undefined]]), '/okf', 1200, NOW)
    expect(small.length).toBeLessThanOrEqual(1200)
    expect(small).toContain('truncated; call mcp__cc-okf__okf_index')
  })

  test('a synthesized index flags what is not plainly trusted', async () => {
    const b = await shop()
    expect(synthesizeIndex(b, 'metrics', NOW)).toContain('* [Legacy revenue](legacy.md) [Metric · machine-confirmed · deprecated]')
    expect(renderDirectory(b, 'metrics', '# Metrics', NOW)).toContain('* legacy.md: machine-confirmed · deprecated')
  })

  test('parseConcept defaults', () => {
    const c = parseConcept('a/b', '/r/a/b.md', 1, '---\ntype: X\n---\n')
    expect(c).toMatchObject({ title: 'b', status: 'stable', trust: 'unverified', tags: [] })
  })
})

describe('toc budget with many bundles', () => {
  test('every bundle keeps its header and the whole stays within budget', async () => {
    const bundles = await Promise.all(
      Array.from({ length: 30 }, (_, i) => scanBundle(memfs({ files: shopTree(`/okf/b${i}`) }), `b${i}`, `/okf/b${i}`, new Map())),
    )
    const indexes = new Map(bundles.map(b => [b.name, undefined]))
    for (const budget of [16_000, 8_000, 3_000]) {
      const toc = renderToc(bundles, indexes, '/okf', budget, NOW)
      expect(toc.length).toBeLessThanOrEqual(budget)
    }
    expect(renderToc(bundles, indexes, '/okf', 16_000, NOW)).toContain('## b29')
    const short = renderToc(bundles, indexes, '/okf', 3_000, NOW)
    expect(short).toContain('tables of contents left out')
    expect(short).toContain('- b29: /okf/b29')
    expect(renderToc(bundles, indexes, '/okf', 1_500, NOW)).toMatch(/- … \d+ more; call mcp__cc-okf__okf_index/)
    for (const budget of [1_200, 1_500]) {
      expect(renderToc(bundles, indexes, '/okf', budget, NOW).length).toBeLessThanOrEqual(budget)
    }
  })
})
