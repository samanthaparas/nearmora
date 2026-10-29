/**
 * Security rules in plain functions: the content security policy, and which URLs count as "our" app.
 * They have no Electron imports, so unit tests can run them directly.
 */

export const APP_SCHEME = 'app'
export const APP_HOST = 'nearmora'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`
export const MEDIA_SCHEME = 'nm-media'

const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  // Thumbnails come only from nm-media://, which serves cached thumbnails by picture id.
  "img-src 'self' nm-media:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

// Vite's dev server injects an inline script for React Fast Refresh and talks
// to the page over a websocket, so development needs a looser policy.
// This policy is never used by a built app.
const DEVELOPMENT_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: nm-media:",
  "connect-src 'self' ws://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

export function contentSecurityPolicy(mode: 'production' | 'development'): string {
  return mode === 'production' ? PRODUCTION_CSP : DEVELOPMENT_CSP
}

const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Reads a thumbnail URL (nm-media://thumb/<asset id>) and returns the asset id, or null for anything else.
 * Only a bare id is accepted, so a URL can never smuggle in a path, query or extra segment.
 */
export function parseThumbnailUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.host !== 'thumb' || parsed.search || parsed.hash) return null
  const id = parsed.pathname.slice(1)
  return ASSET_ID.test(id) ? id : null
}

/**
 * Is this URL one of our own renderer pages?
 *
 * Compares scheme + host rather than `URL.origin`, because WHATWG URL reports
 * an opaque origin ("null") for custom schemes such as app://.
 */
export function isTrustedRendererUrl(url: string | undefined, trustedOrigins: readonly string[]): boolean {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.username || parsed.password) return false
  const origin = `${parsed.protocol}//${parsed.host}`
  return trustedOrigins.includes(origin)
}
