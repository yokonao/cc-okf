import { describe, expect, test } from 'claude-code/testing'
import { discoverBundles, scanBundle } from '../lib/bundle'
import { renderConceptNote } from '../lib/render'
import { linkSiblings, resolveSibling } from '../lib/sibling'
import { NOW, memfs } from './memfs'

const DIR = '/home/u/okf'
const fm = (body: string) => `---\ntype: Note\n---\n${body}\n`

async function scanAll() {
  const fs = memfs({
    files: {
      [`${DIR}/dev/a.md`]: fm('[acc](../kakeibo/acc/x.md) [root](../kakeibo/) [gone](../kakeibo/gone.md) [far](../../kakeibo/acc/x.md)'),
      [`${DIR}/dev/sub/b.md`]: fm('[from concept](../../kakeibo/acc/x.md) [from root](../kakeibo/acc/x.md) [self](../dev/a.md)'),
      [`${DIR}/kakeibo/acc/x.md`]: fm(''),
    },
  })
  const bundles = []
  for (const { name, root } of await discoverBundles(fs, DIR)) bundles.push(await scanBundle(fs, name, root, new Map()))
  linkSiblings(bundles)
  const [dev, kakeibo] = bundles as [(typeof bundles)[0], (typeof bundles)[0]]
  return { dev, kakeibo }
}

describe('sibling bundles', () => {
  test('a link leaving the bundle by one level resolves into the bundle it names', async () => {
    const { dev } = await scanAll()
    const at = (from: string, target: string) => {
      const hit = resolveSibling(dev, from, target)
      return hit === undefined ? undefined : `${hit.bundle.name}:${hit.rel}`
    }
    expect(at('a', '../kakeibo/acc/x.md')).toBe('kakeibo:acc/x.md')
    expect(at('a', '../kakeibo/')).toBe('kakeibo:')
    expect(at('a', '../kakeibo/gone.md')).toBeUndefined()
    expect(at('a', '../../kakeibo/acc/x.md')).toBeUndefined()
    expect(at('a', '/../kakeibo/acc/x.md')).toBeUndefined()
    expect(at('sub/b', '../../kakeibo/acc/x.md')).toBe('kakeibo:acc/x.md')
    expect(at('sub/b', '../kakeibo/acc/x.md')).toBe('kakeibo:acc/x.md')
    expect(at('sub/b', '../dev/a.md')).toBeUndefined()
  })

  test('notes show the target and backlinks across bundles', async () => {
    const { dev, kakeibo } = await scanAll()
    const a = renderConceptNote(dev, dev.concepts.get('a')!, NOW)
    expect(a).toContain(`- ../kakeibo/acc/x.md → ${DIR}/kakeibo/acc/x.md (bundle kakeibo)`)
    expect(a).toContain('- ../kakeibo/gone.md → (outside the bundle) (not in the bundle)')
    const x = renderConceptNote(kakeibo, kakeibo.concepts.get('acc/x')!, NOW)
    expect(x).toContain('Referenced by: dev:a, dev:sub/b')
  })
})
