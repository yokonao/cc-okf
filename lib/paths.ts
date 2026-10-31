// POSIX path helpers: the hooks environment has no `node:path`.

export function normalize(p: string): string {
  const isAbsolute = p.startsWith('/')
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!isAbsolute) out.push('..')
      continue
    }
    out.push(seg)
  }
  const joined = out.join('/')
  return isAbsolute ? `/${joined}` : joined
}

export function join(...parts: string[]): string {
  return normalize(parts.filter(part => part !== '').join('/'))
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  if (i < 0) return ''
  if (i === 0) return '/'
  return p.slice(0, i)
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}

/** The path of `p` relative to `root`, or undefined when `p` lies outside it. */
export function relativeTo(root: string, p: string): string | undefined {
  const r = normalize(root)
  const q = normalize(p)
  if (q === r) return ''
  const prefix = r === '/' ? '/' : `${r}/`
  return q.startsWith(prefix) ? q.slice(prefix.length) : undefined
}
