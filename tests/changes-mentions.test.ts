import { describe, expect, test } from 'claude-code/testing'
import { scanBundle } from '../lib/bundle.ts'
import { KEPT_SESSIONS, diff, fromStored, newestLogSection, renderChanges, snapshot, toStored, touchIndex } from '../lib/changes.ts'
import { resolveMention, suggestMentions } from '../lib/mention.ts'
import { NOW, memfs, shopTree } from './memfs.ts'

const ROOT = '/okf/shop'
const scan = (files: Record<string, string>, mtimeMs?: Record<string, number>) =>
  scanBundle(memfs({ files, mtimeMs }), 'shop', ROOT, new Map())

describe('changes', () => {
  test('added, removed, changed concepts and a changed log.md', async () => {
    const files = shopTree(ROOT)
    const before = snapshot([await scan(files)])
    const after: Record<string, string> = { ...files, [`${ROOT}/metrics/margin.md`]: '---\ntype: Metric\n---\n' }
    delete after[`${ROOT}/skills/run.md`]
    const next = snapshot([await scan(after, { [`${ROOT}/metrics/revenue.md`]: 5, [`${ROOT}/log.md`]: 5 })])
    const d = diff(before, next)
    expect(d.changes).toEqual([
      { bundle: 'shop', added: ['metrics/margin'], removed: ['skills/run'], changed: ['metrics/revenue'], logs: [''] },
    ])
    const text = renderChanges(d, new Map([['shop:', '## 2026-07-01\n* **Update**: revenue.']]))
    expect(text).toContain('  added: metrics/margin')
    expect(text).toContain('  newest entry of /log.md:\n    ## 2026-07-01')
    expect(renderChanges(diff(next, next), new Map())).toBeUndefined()
    expect(diff(next, new Map()).removedBundles).toEqual(['shop'])
  })

  test('snapshots round-trip through plain data; the index keeps the newest sessions', async () => {
    const snap = snapshot([await scan(shopTree(ROOT))])
    expect(fromStored(JSON.parse(JSON.stringify(toStored(snap))))).toEqual(snap)
    expect(fromStored('garbage')).toBeUndefined()
    let index: unknown
    const dropped: string[] = []
    for (let i = 0; i < KEPT_SESSIONS + 3; i++) {
      const r = touchIndex(index, `s${i}`)
      index = r.index
      dropped.push(...r.dropped)
    }
    expect(dropped).toEqual(['s0', 's1', 's2'])
    expect(touchIndex(index, 's5').index.at(-1)).toBe('s5')
  })

  test('the newest log section ends at the next date heading', () => {
    const log = '---\ntype: Log\n---\n# History\n\n## 2026-07-01\n- a\n- b\n\n## 2026-06-30\n- c\n'
    expect(newestLogSection(log)).toBe('## 2026-07-01\n- a\n- b')
    expect(newestLogSection('# Empty')).toBeUndefined()
  })
})

describe('mentions', () => {
  test('okf:<bundle>/<id> resolves to a concept or a directory index', async () => {
    const b = await scan(shopTree(ROOT))
    expect(resolveMention([b], 'okf:shop/metrics/revenue')?.path).toBe(`${ROOT}/metrics/revenue.md`)
    expect(resolveMention([b], 'okf:shop/metrics/revenue.md#L3')?.path).toBe(`${ROOT}/metrics/revenue.md`)
    expect(resolveMention([b], 'okf:shop/')?.path).toBe(`${ROOT}/index.md`)
    expect(resolveMention([b], 'okf:shop/nope')).toBeUndefined()
    expect(resolveMention([b], 'src/a.ts')).toBeUndefined()
  })

  test('typeahead offers bundles, then concepts by id or title', async () => {
    const b = await scan(shopTree(ROOT))
    expect(suggestMentions([b], '@okf:', NOW)[0]).toEqual({ text: '@okf:shop/', label: 'okf:shop/', description: '6 concepts' })
    const byTitle = suggestMentions([b], '@okf:legacy', NOW)
    expect(byTitle.map(s => s.text)).toEqual(['@okf:shop/metrics/legacy'])
    expect(byTitle[0]?.description).toBe('Legacy revenue · Metric · machine-confirmed · deprecated')
    expect(suggestMentions([b], '@okf:shop/metrics/r', NOW).map(s => s.text)).toEqual(['@okf:shop/metrics/revenue'])
    expect(suggestMentions([b], '#123', NOW)).toEqual([])
  })
})
