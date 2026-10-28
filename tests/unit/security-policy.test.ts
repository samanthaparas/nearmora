/**
 * Unit tests for URL trust checks, the content security policy and the app:// file mapping.
 * They include known path-traversal tricks, so a regression shows up immediately.
 */

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_ORIGIN, contentSecurityPolicy, isTrustedRendererUrl } from '../../src/main/security/policy'
import { resolveRendererFile } from '../../src/main/security/renderer-files'

describe('isTrustedRendererUrl', () => {
  const trusted = [APP_ORIGIN, 'http://localhost:5173']

  it.each([
    'app://nearmora/index.html',
    'app://nearmora/',
    'http://localhost:5173/',
    'http://localhost:5173/some/route',
  ])('trusts %s', (url) => {
    expect(isTrustedRendererUrl(url, trusted)).toBe(true)
  })

  it.each([
    undefined,
    '',
    'not a url',
    'app://evil/index.html',
    'app://nearmora.evil.example/',
    'https://nearmora/',
    'http://localhost:5174/',
    'http://user:pass@localhost:5173/',
    'file:///Users/someone/photo.jpg',
  ])('does not trust %s', (url) => {
    expect(isTrustedRendererUrl(url, trusted)).toBe(false)
  })
})

describe('contentSecurityPolicy', () => {
  it('never allows inline or eval in production', () => {
    const csp = contentSecurityPolicy('production')
    expect(csp).not.toContain('unsafe')
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("connect-src 'none'")
  })
})

describe('resolveRendererFile', () => {
  const root = join('/app', 'out', 'renderer')

  it('serves index.html for the root path', () => {
    expect(resolveRendererFile(root, '/')).toBe(join(root, 'index.html'))
  })

  it('serves built assets', () => {
    expect(resolveRendererFile(root, '/assets/index-abc.js')).toBe(join(root, 'assets', 'index-abc.js'))
  })

  it.each([
    '/../main/index.js',
    '/assets/../../preload/index.js',
    '/%2e%2e/main/index.js',
    '/%2E%2E%2Fmain%2Findex.js',
    '/..%5Cmain%5Cindex.js',
    '/index.html%00.png',
    '/%E0%A4%A',
  ])('refuses path traversal: %s', (path) => {
    expect(resolveRendererFile(root, path)).toBeNull()
  })

  it.each(['/package.json', '/assets/map.js.map', '/secrets'])('refuses file types it does not serve: %s', (path) => {
    expect(resolveRendererFile(root, path)).toBeNull()
  })
})
