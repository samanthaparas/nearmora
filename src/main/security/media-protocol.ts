/**
 * Serves thumbnails to the UI at nm-media://thumb/<asset id>.
 * The UI only ever names a picture by its id; this file turns the id into a cached thumbnail,
 * so no request can reach an original photo or any other file on disk.
 */

import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { MEDIA_SCHEME, parseThumbnailUrl } from './policy'

/** Must run before `app` is ready, alongside the app:// registration. */
export const mediaSchemePrivileges = { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true } } as const

const notFound = () => new Response('Not found', { status: 404 })

export function serveThumbnails(resolveThumbnail: (assetId: string) => string | undefined): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    if (request.method !== 'GET') return notFound()
    const assetId = parseThumbnailUrl(request.url)
    const file = assetId ? resolveThumbnail(assetId) : undefined
    if (!file) return notFound()

    const response = await net.fetch(pathToFileURL(file).toString())
    if (!response.ok) return notFound()
    return new Response(response.body, {
      status: 200,
      headers: { 'Content-Type': 'image/webp', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' },
    })
  })
}
