// Prints what cc-okf would put in context for the bundles in a directory:
//   bun scripts/inspect.ts [okf dir] [budget tokens]
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { type FsLike, discoverBundles, scanBundle } from '../lib/bundle'
import { indexBody, renderToc } from '../lib/render'

const fs: FsLike = {
  exists: p => stat(p).then(() => true, () => false),
  list: async p =>
    Promise.all(
      (await readdir(p, { withFileTypes: true })).map(async d => {
        const s = await lstat(`${p}/${d.name}`)
        return { name: d.name, kind: d.isDirectory() ? 'dir' : d.isFile() ? 'file' : 'other', isLink: d.isSymbolicLink(), mtimeMs: s.mtimeMs } as const
      }),
    ),
  read: p => readFile(p, 'utf8'),
  stat: async p => {
    const s = await stat(p)
    return { kind: s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other', mtimeMs: s.mtimeMs, realPath: await realpath(p) }
  },
}

const dir = process.argv[2] ?? `${process.env.HOME}/.claude/okf`
const budget = Number(process.argv[3] ?? 4000)
const started = performance.now()
const bundles = []
const indexes = new Map<string, string | undefined>()
for (const { name, root } of await discoverBundles(fs, dir)) {
  const b = await scanBundle(fs, name, root, new Map())
  bundles.push(b)
  const index = b.indexes.get('')
  indexes.set(name, index === undefined ? undefined : indexBody(await fs.read(index)))
}
const scanMs = performance.now() - started
const toc = renderToc(bundles, indexes, dir, budget * 4, Date.now())
console.log(toc)
console.error(`\n[inspect] ${bundles.length} bundles, ${bundles.reduce((n, b) => n + b.concepts.size, 0)} concepts, scan ${scanMs.toFixed(0)} ms, toc ${toc.length} chars (~${Math.ceil(toc.length / 4)} tokens)`)
