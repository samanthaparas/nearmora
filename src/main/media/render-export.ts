/**
 * Renders one export file (a collage, or one carousel slide) from the original photos, using the same shared layout
 * math and drawing order as the on-screen preview (AC7, ADR-0017). The output is a fresh sRGB JPEG with full-resolution colour and no metadata at all: no location, camera,
 * EXIF, XMP or IPTC (sharp writes none unless asked). Transparency is flattened onto the chosen background.
 * Originals are only read.
 */

import { rmSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { placePhoto, type Crop, type Fit, type Rect } from '@shared/layout'
import type { PhotoElement } from '@shared/studio/compose'
import { svgTransform, type Layer } from '@shared/studio/layers'
import { MAX_INPUT_PIXELS } from './limits'

export interface RenderRequest {
  outputPath: string
  width: number
  height: number
  /** Background colour as #rrggbb. */
  background: string
  /** The frame around each photo, in canvas pixels (width 0 means none). */
  border: { width: number; color: string }
  /** For print sizes, the pixels per inch recorded in the file, so print software sizes it correctly. */
  ppi: number | null
  quality: number
  /** The canvas in drawing order: shapes (captions already outlined) and photos with their originals. */
  layers: RenderLayer[]
}

export type RenderLayer =
  | Extract<Layer, { kind: 'shape' }>
  | { kind: 'photo'; sourcePath: string; crop: Crop; fit: Fit; element: Pick<PhotoElement, 'rect' | 'rotation' | 'mask' | 'frame'> }

export type RenderResult = { ok: true } | { ok: false; reason: 'disk_full' | 'unreadable' | 'failed' }

const open = (path: string) => sharp(path, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })

/**
 * Records a print density in a standard JFIF header (18 bytes: units in inches, the same density across and down),
 * inserted right after the JPEG's start marker. Unlike an EXIF block, it carries nothing but the density.
 */
export function withPrintDensity(jpeg: Buffer, ppi: number): Buffer {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || (jpeg[2] === 0xff && jpeg[3] === 0xe0)) throw new Error('Unexpected JPEG header')
  const header = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, ppi >> 8, ppi & 0xff, ppi >> 8, ppi & 0xff, 0x00, 0x00])
  return Buffer.concat([jpeg.subarray(0, 2), header, jpeg.subarray(2)])
}

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

// Path data and colours come from our own templates and validated settings; attribute values are still escaped.
const attr = (value: string | number) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * Builds the canvas as one SVG, in the shared drawing order (layers.ts): shapes, then each photo (turned, on its card,
 * cut to its mask, with its border), then shapes and captions on top. Each photo is first cropped and resized by sharp
 * to exactly the whole pixels it covers, so the SVG renderer places it without resampling unless it's turned.
 */
async function canvasSvg(request: RenderRequest): Promise<string> {
  const parts: string[] = [`<rect width="${request.width}" height="${request.height}" fill="${attr(request.background)}"/>`]
  for (const [index, layer] of request.layers.entries()) {
    if (layer.kind === 'shape') {
      const paint = `fill="${attr(layer.fill ?? 'none')}"${layer.fillRule ? ` fill-rule="${layer.fillRule}"` : ''}`
      const stroke = layer.stroke ? ` stroke="${attr(layer.stroke.color)}" stroke-width="${layer.stroke.width}" stroke-linecap="round" stroke-linejoin="round"` : ''
      const at = layer.at ? ` transform="${attr(svgTransform(layer.at))}"` : ''
      const opacity = layer.opacity !== undefined ? ` opacity="${layer.opacity}"` : ''
      parts.push(`<path d="${attr(layer.d)}" ${paint}${stroke}${opacity}${at}/>`)
      continue
    }
    const metadata = await open(layer.sourcePath).metadata()
    // Crops are defined on the photo as displayed (after EXIF rotation), as in the preview.
    const shown = metadata.autoOrient ?? { width: metadata.width, height: metadata.height }
    const { rect, rotation, mask, frame } = layer.element
    // A masked photo fills its whole rectangle; its border is drawn along the mask instead (see below).
    const place = placePhoto(shown, rect, layer.crop, layer.fit, mask ? 0 : request.border.width)
    const dest = snap(place.dest)
    const piece = await open(layer.sourcePath)
      .rotate() // apply EXIF orientation first; the crop below is in upright coordinates
      .extract(pixelRect(shown, place.src))
      .resize(dest.width, dest.height, { fit: 'fill' })
      .toColourspace('srgb')
      .png({ compressionLevel: 1 })
      .toBuffer()
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    const group: string[] = []
    if (frame) {
      const card = { x: rect.x - frame.pad, y: rect.y - frame.pad, width: rect.width + 2 * frame.pad, height: rect.height + 2 * frame.pad }
      group.push(`<rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" fill="${attr(frame.color)}"/>`)
    }
    if (place.frame) {
      const f = snap(place.frame)
      group.push(`<rect x="${f.left}" y="${f.top}" width="${f.width}" height="${f.height}" fill="${attr(request.border.color)}"/>`)
    }
    const image = `<image x="${dest.left}" y="${dest.top}" width="${dest.width}" height="${dest.height}" preserveAspectRatio="none" href="data:image/png;base64,${piece.toString('base64')}"/>`
    if (mask) {
      // The border runs along the inside of the mask: a stroke twice as wide, half of it clipped away.
      const border = request.border.width > 0 ? `<path d="${attr(mask)}" fill="none" stroke="${attr(request.border.color)}" stroke-width="${2 * request.border.width}"/>` : ''
      group.push(`<clipPath id="mask${index}"><path d="${attr(mask)}"/></clipPath><g clip-path="url(#mask${index})">${image}${border}</g>`)
    } else group.push(image)
    parts.push(rotation ? `<g transform="rotate(${rotation} ${cx} ${cy})">${group.join('')}</g>` : group.join(''))
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${request.width}" height="${request.height}" viewBox="0 0 ${request.width} ${request.height}">${parts.join('')}</svg>`
}

export async function renderCanvas(request: RenderRequest): Promise<RenderResult> {
  let svg: string
  try {
    svg = await canvasSvg(request)
  } catch {
    return { ok: false, reason: 'unreadable' }
  }

  try {
    // `unlimited`: the SVG is our own, and embeds full-size photo pieces that exceed the parser's default size guard.
    const encoded = await sharp(Buffer.from(svg), { unlimited: true, limitInputPixels: false })
      .flatten({ background: request.background }) // any transparency becomes the background colour, on purpose
      .toColourspace('srgb')
      // Full-resolution colour (4:4:4): the default stores colour at half resolution, which visibly smears saturated
      // edges such as red petals. mozjpeg's encoder keeps the larger file in check (owner's review, R5).
      .jpeg({ quality: request.quality, chromaSubsampling: '4:4:4', mozjpeg: true })
      .toBuffer()
    writeFileSync(request.outputPath, request.ppi ? withPrintDensity(encoded, request.ppi) : encoded)
    return { ok: true }
  } catch (error: unknown) {
    rmSync(request.outputPath, { force: true })
    const message = error instanceof Error ? `${error.message} ${'code' in error ? String(error.code) : ''}` : String(error)
    return { ok: false, reason: /ENOSPC|No space left/i.test(message) ? 'disk_full' : 'failed' }
  }
}
