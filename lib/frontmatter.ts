import { CORE_SCHEMA, load } from './vendor/js-yaml.mjs'

export type Frontmatter = {
  data: Readonly<Record<string, unknown>>
  body: string
  problem?: string
}

const BLOCK = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/

export function parseFrontmatter(text: string): Frontmatter {
  const src = text.replace(/^﻿/, '')
  const m = BLOCK.exec(src)
  if (!m) return { data: {}, body: src, problem: 'no frontmatter block' }

  const body = src.slice(m[0].length)
  let data: unknown
  try {
    // CORE_SCHEMA keeps timestamps as strings, as OKF compares them textually.
    data = load(m[1] ?? '', { schema: CORE_SCHEMA })
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n')[0] : String(err)
    return { data: {}, body, problem: `frontmatter is not valid YAML: ${message}` }
  }
  if (data == null) return { data: {}, body }
  if (typeof data !== 'object' || Array.isArray(data)) {
    return { data: {}, body, problem: 'frontmatter is not a mapping' }
  }
  return { data: data as Record<string, unknown>, body }
}
