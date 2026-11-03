/**
 * Unit tests for the licence-notice builder (scripts/notices.mjs): it finds each package's licence text, takes
 * libvips's from its README with where its LGPL source is, and reports any package without one, which fails the build.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectNotices } from '../../scripts/notices.mjs'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// A pretend project with the given packages: name → { version, license, files }.
function project(packages: Record<string, { version: string; license?: string; files: Record<string, string> }>): string {
  const root = mkdtempSync(join(tmpdir(), 'nearmora-notices-'))
  roots.push(root)
  for (const [name, { version, license, files }] of Object.entries(packages)) {
    const dir = join(root, 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, license }))
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text)
  }
  return root
}

describe('licence notices', () => {
  it('takes each package’s licence file, sorted by name, with its version, licence and how it ships', () => {
    const root = project({
      zeta: { version: '2.0.0', license: 'MIT', files: { 'LICENSE.md': 'MIT text\n' } },
      '@scope/alpha': { version: '1.0.0', license: 'OFL-1.1', files: { LICENSE: 'OFL text' } },
    })
    const { notices, missing } = collectNotices(new Map([['zeta', 'shipped'], ['@scope/alpha', 'bundled']]), root)
    expect(missing).toEqual([])
    expect(notices).toEqual([
      { name: '@scope/alpha', version: '1.0.0', license: 'OFL-1.1', kind: 'bundled', text: 'OFL text' },
      { name: 'zeta', version: '2.0.0', license: 'MIT', kind: 'shipped', text: 'MIT text' },
    ])
  })

  it('takes libvips’s notice from its README, with where the source of its LGPL libraries is', () => {
    const root = project({
      '@img/sharp-libvips-darwin-arm64': { version: '1.3.4', license: 'LGPL-3.0-or-later', files: { 'README.md': '# libvips\n\nIntro.\n\n## Licensing\n\n| glib | LGPLv3 |\n' } },
    })
    const { notices, missing } = collectNotices(new Map([['@img/sharp-libvips-darwin-arm64', 'shipped']]), root)
    expect(missing).toEqual([])
    const text = notices[0]?.text ?? ''
    expect(text).toMatch(/^## Licensing\n\n\| glib \| LGPLv3 \|/)
    expect(text).toContain('https://github.com/lovell/sharp-libvips')
    expect(text).not.toContain('Intro.')
  })

  it('reports a package with no licence text, so the build stops before it can ship without one', () => {
    const root = project({ quiet: { version: '0.1.0', files: { 'README.md': 'No licence here.' } } })
    expect(collectNotices(new Map([['quiet', 'shipped']]), root).missing).toEqual(['quiet'])
  })
})
