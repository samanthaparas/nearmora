/**
 * Serves the built UI from app://nearmora with security headers attached.
 * Loading from file:// instead would let the page read any file the user can.
 */

import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { mediaSchemePrivileges } from './media-protocol'
import { APP_HOST, APP_SCHEME, contentSecurityPolicy } from './policy'
import { contentTypeFor, resolveRendererFile } from './renderer-files'

/**
 * Must run before `app` is ready, and only once: a second call replaces the first.
 * A "standard" + "secure" scheme behaves like https for the browser engine: it gets
 * a real origin for 'self' in the CSP. We serve the built UI from app://nearmora
 * instead of file://, which would let a page read any local file the user can.
 * nm-media:// (thumbnails) is registered here too for the same reason.
 */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    mediaSchemePrivileges,
  ])
}

const notFound = () => new Response('Not found', { status: 404 })

// Answers every app:// request: map the URL to a safe file, then attach the security headers.
export function serveRendererFromAppScheme(rendererRoot: string): void {
  const csp = contentSecurityPolicy('production')

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== APP_HOST || request.method !== 'GET') return notFound()

    const filePath = resolveRendererFile(rendererRoot, url.pathname)
    if (!filePath) return notFound()

    const file = await net.fetch(pathToFileURL(filePath).toString())
    if (!file.ok) return notFound()

    return new Response(file.body, {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(filePath) ?? 'application/octet-stream',
        'Content-Security-Policy': csp,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    })
  })
}
