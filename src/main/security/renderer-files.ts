/**
 * Decides which built UI file, if any, an app:// URL maps to.
 * This stops a crafted URL (like ../../) from reading files outside the app's own folder.
 */

import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

// The only file types the app:// protocol will serve. Anything else is a 404.
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

export function contentTypeFor(filePath: string): string | undefined {
  return CONTENT_TYPES[extname(filePath).toLowerCase()]
}

/**
 * Map an app:// URL path to a file inside the built renderer folder.
 * Returns null for anything that would escape that folder (../, encoded
 * traversal, absolute paths) or that isn't an allowed file type.
 */
export function resolveRendererFile(rendererRoot: string, urlPathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPathname)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null

  const requested = decoded === '/' || decoded === '' ? '/index.html' : decoded
  const root = resolve(rendererRoot)
  const candidate = resolve(root, `.${requested}`)

  const rel = relative(root, candidate)
  if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) return null
  if (!contentTypeFor(candidate)) return null
  return candidate
}
