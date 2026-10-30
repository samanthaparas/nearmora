/**
 * Renders one export file (a collage, or one carousel slide) from the original photos, using the same shared layout
 * math as the on-screen preview (AC7). The output is a fresh sRGB JPEG with full-resolution colour and no metadata at all: no location, camera,
 * EXIF, XMP or IPTC (sharp writes none unless asked). Transparency is flattened onto the chosen background.
 * Originals are only read.
 */

import { rmSync } from 'node:fs'
import sharp from 'sharp'
import { placePhoto, type Crop, type Fit, type Rect } from '@shared/layout'
import { MAX_INPUT_PIXELS } from './limits'

export interface RenderRequest {
  outputPath: string
  width: number
  height: number
  /** Background colour as #rrggbb. */
  background: string
  /** The frame around each photo, in canvas pixels (width 0 means none). */
  border: { width: number; color: string }
  quality: number
  layers: Array<{ sourcePath: string; crop: Crop; fit: Fit; cell: Rect }>
}

export type RenderResult = { ok: true } | { ok: false; reason: 'disk_full' | 'unreadable' | 'failed' }

const open = (path: string) => sharp(path, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })

// A canvas rectangle in whole pixels, as sharp places composites.
const snap = (rect: Rect) => {
  const left = Math.round(rect.x)
  const top = Math.round(rect.y)
  return { left, top, width: Math.max(1, Math.round(rect.x + rect.width) - left), height: Math.max(1, Math.round(rect.y + rect.height) - top) }
}

// The crop rectangle in whole pixels, kept inside the photo.
function pixelRect(image: { width: number; height: number }, rect: Rect): { left: number; top: number; width: number; height: number } {
  const left = Math.min(image.width - 1, Math.max(0, Math.round(rect.x)))
  const top = Math.min(image.height - 1, Math.max(0, Math.round(rect.y)))
  return {
    left,
    top,
    width: Math.max(1, Math.min(image.width - left, Math.round(rect.width))),
    height: Math.max(1, Math.min(image.height - top, Math.round(rect.height))),
  }
}

export async function renderCanvas(request: RenderRequest): Promise<RenderResult> {
  const composites: Array<{ input: Buffer; left: number; top: number }> = []
  try {
    for (const layer of request.layers) {
      const metadata = await open(layer.sourcePath).metadata()
      // Crops are defined on the photo as displayed (after EXIF rotation), as in the preview.
      const shown = metadata.autoOrient ?? { width: metadata.width, height: metadata.height }
      // The same placement the preview uses: border, the part of the photo shown, and where it goes.
      const place = placePhoto(shown, layer.cell, layer.crop, layer.fit, request.border.width)
      if (place.frame) {
        const frame = snap(place.frame)
        const fill = await sharp({ create: { width: frame.width, height: frame.height, channels: 3, background: request.border.color } }).png().toBuffer()
        composites.push({ input: fill, left: frame.left, top: frame.top })
      }
      const dest = snap(place.dest)
      const piece = await open(layer.sourcePath)
        .rotate() // apply EXIF orientation first; the crop below is in upright coordinates
        .extract(pixelRect(shown, place.src))
        .resize(dest.width, dest.height, { fit: 'fill' })
        .toColourspace('srgb')
        .png()
        .toBuffer()
      composites.push({ input: piece, left: dest.left, top: dest.top })
    }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }

  try {
    await sharp({ create: { width: request.width, height: request.height, channels: 3, background: request.background } })
      .composite(composites)
      .flatten({ background: request.background }) // any transparency becomes the background colour, on purpose
      .toColourspace('srgb')
      // Full-resolution colour (4:4:4): the default stores colour at half resolution, which visibly smears saturated
      // edges such as red petals. mozjpeg's encoder keeps the larger file in check (owner's review, R5).
      .jpeg({ quality: request.quality, chromaSubsampling: '4:4:4', mozjpeg: true })
      .toFile(request.outputPath)
    return { ok: true }
  } catch (error: unknown) {
    rmSync(request.outputPath, { force: true })
    const message = error instanceof Error ? `${error.message} ${'code' in error ? String(error.code) : ''}` : String(error)
    return { ok: false, reason: /ENOSPC|No space left/i.test(message) ? 'disk_full' : 'failed' }
  }
}
