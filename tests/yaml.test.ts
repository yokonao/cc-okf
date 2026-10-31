import { describe, expect, test } from 'claude-code/testing'
import { parseFrontmatter } from '../lib/frontmatter.ts'

// Runs in the hooks environment, so it also shows the vendored js-yaml loads there.
describe('vendored js-yaml', () => {
  test('the YAML that OKF frontmatter uses', () => {
    const { data, problem } = parseFrontmatter(`---
type: "Attested Computation"
title: 'Revenue: FY'
tags: [a, "b c"]
parameters:
  - { name: year, type: integer, required: true }
defaults: &d { by: human:x, at: 2026-01-01T00:00:00Z }
verified:
  - *d
  - by: process:y
    at: 2026-02-01
description: >-
  folded
  text
notes: |
  line 1
  line 2
count: 5
ratio: 0.5
flag: yes
empty:
custom_key: { nested: [1, 2] }
---
body`)
    expect(problem).toBeUndefined()
    expect(data).toEqual({
      type: 'Attested Computation',
      title: 'Revenue: FY',
      tags: ['a', 'b c'],
      parameters: [{ name: 'year', type: 'integer', required: true }],
      defaults: { by: 'human:x', at: '2026-01-01T00:00:00Z' },
      verified: [
        { by: 'human:x', at: '2026-01-01T00:00:00Z' },
        { by: 'process:y', at: '2026-02-01' },
      ],
      description: 'folded text',
      notes: 'line 1\nline 2\n',
      count: 5,
      ratio: 0.5,
      flag: 'yes',
      empty: null,
      custom_key: { nested: [1, 2] },
    })
  })

  test('a non-mapping or a duplicate key is reported, not thrown', () => {
    expect(parseFrontmatter('---\n- a\n- b\n---\n').problem).toBe('frontmatter is not a mapping')
    expect(parseFrontmatter('---\ntype: A\ntype: B\n---\n').problem).toMatch(/not valid YAML/)
  })
})
