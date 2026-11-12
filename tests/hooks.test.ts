import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { scanBundle } from '../lib/bundle'
import { snapshot, toStored } from '../lib/changes'
import { NOW, memfs, shopTree } from './memfs'

const OKF = '/home/u/.claude/okf'
const ROOT = `${OKF}/shop`
const TYPED = { wait: false, origin: { kind: 'composer' } } as const

/** Stands for the engine beneath the plugin: a home with one bundle, linked in from elsewhere. */
function engine(
  on: On,
  files = shopTree('/data/shop'),
  mtimeMs: Record<string, number> = {},
  store: Record<string, unknown> | 'refuse' = {},
  sessionId = 's1',
  clock = { now: NOW },
) {
  const fs = memfs({ files, mtimeMs, links: { [ROOT]: '/data/shop' } })
  mock.env(on, { HOME: '/home/u' })
  on('clock.now', () => ({ value: clock.now }))
  if (store === 'refuse') {
    on('store.get', () => ({ value: undefined }))
    on('store.set', () => ({ deny: 'too large' }))
  } else {
    mock.store(on, store)
  }
  on('session.id', () => ({ value: sessionId }))
  on('fs.exists', async (_, e) => ({ value: await fs.exists(e.path) }))
  on('fs.list', async (_, e) => ({ value: (await fs.list(e.path)).map(entry => ({ ...entry, size: 0 })) }))
  on('fs.read', async (_, e) => ({ value: await fs.read(e.path) }))
  on('fs.stat', async (_, e) => ({ value: { size: 0, isLink: e.path === ROOT, ...(await fs.stat(e.path)) } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__cc-okf__${e.name}` } }))
  on('command.register', () => ({ value: { command: 'okf' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('tool.call', () => ({ result: { type: 'text', file: { filePath: '', content: '' } } }))
}

test('a Read inside a bundle gets the concept note, through the link or its target', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })

  for (const path of [`${ROOT}/metrics/revenue.md`, '/data/shop/metrics/revenue.md']) {
    const read = await $.tool.call({ tool: 'Read', file_path: path })
    expect(read.context?.join('\n')).toContain('cc-okf: OKF concept shop:metrics/revenue')
  }
  const outside = await $.tool.call({ tool: 'Read', file_path: '/etc/hosts.md' })
  expect(outside.context).toBeUndefined()
  const index = await $.tool.call({ tool: 'Read', file_path: `${ROOT}/index.md` })
  expect(index.context?.join('\n')).toContain(`relative to ${ROOT}/`)
})

test('a concept attached with @ gets the same note; other files and missing ones do not', async ($, on) => {
  engine(on)
  on('prompt.mention', (_, e) => ({ type: e.path.includes('missing') ? null : 'file' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })

  const concept = await $.prompt.mention({ mention: 'shop/metrics/revenue.md', path: `${ROOT}/metrics/revenue.md` })
  expect(concept.context?.join('\n')).toContain('cc-okf: OKF concept shop:metrics/revenue')
  const outside = await $.prompt.mention({ mention: 'notes.md', path: '/home/u/notes.md' })
  expect(outside.context).toBeUndefined()
  const missing = await $.prompt.mention({ mention: 'missing.md', path: `${ROOT}/missing.md` })
  expect(missing.context).toBeUndefined()
})

test('okf_search and okf_index answer from the scanned bundle', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })

  const found = await $.tool.call({ tool: 'mcp__cc-okf__okf_search', query: 'revenue', min_trust: 'human-reviewed' })
  expect(found.result).toBe(
    `- shop:metrics/revenue [Metric · human-reviewed · stale] Revenue — Recognized revenue for a fiscal year.\n  ${ROOT}/metrics/revenue.md`,
  )

  const bundles = await $.tool.call({ tool: 'mcp__cc-okf__okf_index' })
  expect(String(bundles.result)).toContain(`- shop: 6 concepts`)
  const metrics = await $.tool.call({ tool: 'mcp__cc-okf__okf_index', bundle: 'shop', dir: '/metrics/' })
  expect(String(metrics.result)).toContain('No index.md here; synthesized from frontmatter.')
  const missing = await $.tool.call({ tool: 'mcp__cc-okf__okf_index', bundle: 'nope' })
  expect(String(missing.result)).toContain('No bundle named "nope"')
})

test('a prompt after the bundle changed carries a change note, once', async ($, on) => {
  const files = shopTree('/data/shop')
  const mtimeMs: Record<string, number> = {}
  const clock = { now: NOW }
  engine(on, files, mtimeMs, {}, 's1', clock)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })

  expect((await $.prompt.submit({ ...TYPED, text: 'first' })).context).toBeUndefined()
  files['/data/shop/metrics/margin.md'] = '---\ntype: Metric\n---\n'
  mtimeMs['/data/shop/log.md'] = 9
  // Within the rescan interval the change waits for a later prompt.
  expect((await $.prompt.submit({ ...TYPED, text: 'soon after' })).context).toBeUndefined()
  clock.now += 30_000
  const second = await $.prompt.submit({ ...TYPED, text: 'second' })
  expect(second.context?.join('\n')).toContain('added: metrics/margin')
  expect(second.context?.join('\n')).toContain('newest entry of /log.md:\n    ## 2026-07-01')
  expect((await $.prompt.submit({ ...TYPED, text: 'third' })).context).toBeUndefined()
})

test('a session resumed in a new process still gets the change note', async ($, on) => {
  const files = shopTree('/data/shop')
  // What an earlier process of session s1 stored, before metrics/margin was added.
  const before = await scanBundle(memfs({ files, links: { [ROOT]: '/data/shop' } }), 'shop', ROOT, new Map())
  const store = { 'told:s1': toStored(snapshot([before])) }
  files['/data/shop/metrics/margin.md'] = '---\ntype: Metric\n---\n'
  engine(on, files, {}, store, 's1')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })

  const first = await $.prompt.submit({ ...TYPED, text: 'back again' })
  expect(first.context?.join('\n')).toContain('added: metrics/margin')
})

test('another session starts from what it is shown, with no note', async ($, on) => {
  const before = await scanBundle(memfs({ files: shopTree('/data/shop'), links: { [ROOT]: '/data/shop' } }), 'shop', ROOT, new Map())
  engine(on, shopTree('/data/shop'), {}, { 'told:old': toStored(snapshot([before])) }, 'new')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  expect((await $.prompt.submit({ ...TYPED, text: 'hi' })).context).toBeUndefined()
})

test('a store that refuses the snapshot still leaves the table of contents in place', async ($, on) => {
  engine(on, shopTree('/data/shop'), {}, 'refuse')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  expect((await $.prompt.submit({ ...TYPED, text: 'hi' })).context).toBeUndefined()
})

function home(on: On, env: Record<string, string>, links: Record<string, string> = {}, canList = true) {
  const fs = memfs({ files: shopTree('/home/u/.okf/shop'), links })
  mock.env(on, { HOME: '/home/u', ...env })
  mock.clock(on, { now: NOW })
  mock.store(on, {})
  on('session.id', () => ({ value: 's1' }))
  on('fs.exists', async (_, e) => ({ value: await fs.exists(e.path) }))
  on('fs.list', async (_, e) =>
    canList ? { value: (await fs.list(e.path)).map(entry => ({ ...entry, size: 0 })) } : { deny: 'EACCES' },
  )
  on('fs.read', async (_, e) => ({ value: await fs.read(e.path) }))
  on('fs.stat', async (_, e) => ({ value: { size: 0, isLink: false, ...(await fs.stat(e.path)) } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__cc-okf__${e.name}` } }))
  on('command.register', () => ({ value: { command: 'okf' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.context', (_, e) => ({ blocks: e.blocks }))
}

test('the bundlesDir option moves where bundles are read, ~ meaning home', { options: { bundlesDir: '~/.okf' } }, async ($, on) => {
  home(on, {})
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  const listed = await $.tool.call({ tool: 'mcp__cc-okf__okf_index' })
  expect(String(listed.result)).toContain('OKF bundles in /home/u/.okf:')
  expect(String(listed.result)).toContain('- shop: 6 concepts')
})

test('OKF_DIR applies when the option is empty', async ($, on) => {
  home(on, { OKF_DIR: '~/.okf' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  const listed = await $.tool.call({ tool: 'mcp__cc-okf__okf_index' })
  expect(String(listed.result)).toContain('OKF 0.2 — /home/u/.okf/shop')
})

test('a table of contents still comes when the bundles directory cannot be listed', async ($, on) => {
  home(on, { OKF_DIR: '~/.okf' }, {}, false)
  const result = await $.prompt.context({ blocks: [{ name: 'currentDate', text: 'today' }] })
  expect(result.blocks.map(b => b.name)).toEqual(['currentDate'])
})

test('a bundle with a dangling link still reaches the table of contents', async ($, on) => {
  home(on, { OKF_DIR: '~/.okf' }, { '/home/u/.okf/shop/dangling': '/nonexistent' })
  const result = await $.prompt.context({ blocks: [] })
  expect(result.blocks.find(b => b.name === 'okfBundles')?.text).toContain('## shop\nPath: /home/u/.okf/shop · 6 concepts')
  expect(result.blocks.find(b => b.name === 'okfBundles')?.text).toContain('1 entry skipped')
})
