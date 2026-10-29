/**
 * What counts as a supported photo, and the size limits that protect the app from huge or malicious files.
 * A file is judged by its first bytes (its "magic number"), never by its extension, which anyone can rename.
 */

export type SupportedMediaType = 'image/jpeg' | 'image/png'

/** Files above this are counted as too large and never decoded (roadmap §6.6). */
export const MAX_FILE_BYTES = 200 * 1024 * 1024
/** sharp refuses to decode images with more pixels than this, so a tiny file can't expand into gigabytes. */
export const MAX_INPUT_PIXELS = 100_000_000
/** How many bytes `detectMediaType` needs to see. */
export const SIGNATURE_BYTES = 8

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function detectMediaType(header: Uint8Array): SupportedMediaType | null {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'image/jpeg'
  if (header.length >= 8 && PNG_SIGNATURE.every((byte, i) => header[i] === byte)) return 'image/png'
  return null
}

/** Hidden files and folders (.DS_Store, ._ resource forks, .Trashes) are skipped, not counted. */
export function isHiddenName(name: string): boolean {
  return name.startsWith('.')
}
