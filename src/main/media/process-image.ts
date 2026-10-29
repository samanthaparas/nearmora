/**
 * Everything Nearmora learns from one photo's pixels: size, orientation, date taken, a thumbnail and a dHash.
 * It runs inside the media worker process; it reads the original and writes only the thumbnail it's told to.
 */

import { renameSync, rmSync } from 'node:fs'
import exifr from 'exifr'
import sharp from 'sharp'
import { MAX_INPUT_PIXELS } from './limits'

export interface ProcessImageRequest {
  /** The original photo. Opened read-only. */
  sourcePath: string
  /** Where to write the thumbnail, inside the app's cache folder. */
  thumbnailPath: string
}

export type ProcessImageResult =
  | {
      ok: true
      width: number
      height: number
      orientation: number | null
      /** Epoch ms from the photo's own "date taken", or null if it has none. */
      capturedAt: number | null
      /** 64-bit difference hash as hex, used by R4 to find visually similar photos. */
      dhash: string
    }
  | { ok: false; reason: 'corrupt' | 'too_large' }

export const THUMBNAIL_SIZE = 512

// failOn 'error' rejects truncated or damaged files instead of rendering grey garbage.
const open = (path: string) => sharp(path, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })

/**
 * dHash: shrink to 9×8 grey pixels and record, for each row, whether each pixel is brighter than its neighbour.
 * Similar-looking photos get hashes that differ in only a few of the 64 bits.
 */
async function differenceHash(path: string): Promise<string> {
  const pixels = await open(path).rotate().grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
  let bits = 0n
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      bits = (bits << 1n) | (pixels[row * 9 + col]! > pixels[row * 9 + col + 1]! ? 1n : 0n)
    }
  }
  return bits.toString(16).padStart(16, '0')
}

async function dateTaken(path: string): Promise<number | null> {
  try {
    const tags = (await exifr.parse(path, { pick: ['DateTimeOriginal', 'CreateDate'] })) as
      | { DateTimeOriginal?: unknown; CreateDate?: unknown }
      | undefined
    const date = tags?.DateTimeOriginal ?? tags?.CreateDate
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : null
  } catch {
    // Missing or malformed EXIF is common and not an error; the scanner falls back to the file date.
    return null
  }
}

export async function processImage({ sourcePath, thumbnailPath }: ProcessImageRequest): Promise<ProcessImageResult> {
  const metadata = await open(sourcePath)
    .metadata()
    .catch(() => null)
  if (!metadata?.width || !metadata.height) return { ok: false, reason: 'corrupt' }
  if (metadata.width * metadata.height > MAX_INPUT_PIXELS) return { ok: false, reason: 'too_large' }

  // Write to a temporary name and rename, so a crash never leaves a half-written thumbnail in the cache.
  const partial = `${thumbnailPath}.partial`
  try {
    await open(sourcePath)
      .rotate() // apply the EXIF orientation, so sideways phone photos display upright
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(partial)
    renameSync(partial, thumbnailPath)
    const [dhash, capturedAt] = await Promise.all([differenceHash(sourcePath), dateTaken(sourcePath)])

    // Store the size the photo is displayed at, after rotation.
    const display = metadata.autoOrient ?? { width: metadata.width, height: metadata.height }
    return { ok: true, width: display.width, height: display.height, orientation: metadata.orientation ?? null, capturedAt, dhash }
  } catch {
    rmSync(partial, { force: true })
    return { ok: false, reason: 'corrupt' }
  }
}
