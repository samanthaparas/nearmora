// Pure security rules, kept free of Electron imports so unit tests can run them in Node.

export const APP_SCHEME = 'app'
export const APP_HOST = 'nearmora'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`

const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self'",
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
  "img-src 'self' data:",
  "connect-src 'self' ws://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

export function contentSecurityPolicy(mode: 'production' | 'development'): string {
  return mode === 'production' ? PRODUCTION_CSP : DEVELOPMENT_CSP
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
