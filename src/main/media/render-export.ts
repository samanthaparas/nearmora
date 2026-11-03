/**
 * Renders one export canvas (a collage, a carousel slide, or a seamless carousel's whole design cut into its slides) from the original photos, using the same shared layout
 * math and drawing order as the on-screen preview (AC7, ADR-0017). The output is a fresh sRGB JPEG with full-resolution colour and no metadata at all: no location, camera,
 * EXIF, XMP or IPTC (sharp writes none unless asked). Transparency is flattened onto the chosen background.
 * Originals are only read.
 */

import { rmSync, writeFileSync } from 'node:fs'
import sharp, { type Sharp } from 'sharp'
import { placePhoto, type Crop, type Fit, type Rect } from '@shared/layout'
import type { PhotoElement } from '@shared/studio/compose'
import { svgTransform, type Layer } from '@shared/studio/layers'
import { sliceWidths } from '@shared/studio/slices'
import { MAX_INPUT_PIXELS } from './limits'

export interface RenderRequest {
  /**
   * Where the files go. One path: the whole canvas. Several: the canvas is drawn once and cut left to right into that
   * many slices by the remainder rule (slices.ts), so the slices fit back together exactly.
   */
  outputPaths: readonly string[]
  /** Also saves the whole canvas here, from the same pixels and with the same settings (a seamless design's whole view). */
  wholePath?: string
  /** JPEG for every export. PNG (lossless) is used only by tests, to prove slices reassemble pixel for pixel. */
  encoding?: 'jpeg' | 'png'
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
  | { kind: 'photo'; sourcePath: string; crop: Crop; fit: Fit; element: Pick<PhotoElement, 'rect' | 'rotation' | 'mask' | 'frame'> & { flip?: boolean } }

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
 * One photo cropped and resized by sharp to exactly the whole pixels it covers (EXIF orientation applied first, then
 * mirrored if flipped), with where it goes and the border rectangle behind it, if any.
 */
async function photoPiece(layer: Extract<RenderLayer, { kind: 'photo' }>, borderWidth: number) {
  const metadata = await open(layer.sourcePath).metadata()
  // Crops are defined on the photo as displayed (after EXIF rotation), as in the preview.
  const shown = metadata.autoOrient ?? { width: metadata.width, height: metadata.height }
  // A masked photo fills its whole rectangle; its border is drawn along the mask instead (see canvasSvg).
  const place = placePhoto(shown, layer.element.rect, layer.crop, layer.fit, layer.element.mask ? 0 : borderWidth)
  const dest = snap(place.dest)
  const pixels = open(layer.sourcePath)
    .rotate() // apply EXIF orientation first; the crop below is in upright coordinates
    .extract(pixelRect(shown, place.src))
    .resize(dest.width, dest.height, { fit: 'fill' })
    // A flipped photo (S6a) is mirrored left to right within its place, as the preview draws it.
    .flop(layer.element.flip === true)
    .toColourspace('srgb')
  return { dest, borderRect: place.frame ? snap(place.frame) : null, pixels }
}

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
    const { rect, rotation, mask, frame } = layer.element
    const { dest, borderRect, pixels } = await photoPiece(layer, request.border.width)
    const piece = await pixels.png({ compressionLevel: 1 }).toBuffer()
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    const group: string[] = []
    if (frame) {
      const card = { x: rect.x - frame.pad, y: rect.y - frame.pad, width: rect.width + 2 * frame.pad, height: rect.height + 2 * frame.pad }
      group.push(`<rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" fill="${attr(frame.color)}"/>`)
    }
    if (borderRect) {
      const f = borderRect
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
  // Photos at the top of the drawing order that are upright, unshaped, on no card and wholly on the canvas are placed
  // straight onto the drawn image as pixels (S7). Embedding them in the SVG instead made a 10-photo 16 × 24 in export
  // take about a minute, almost all of it the SVG renderer unpacking the embedded images; placed directly, the pixels
  // are the same. Anything tilted, shaped, on a card or under a decoration stays in the SVG, so the order never changes.
  const placeable = (l: RenderLayer): l is Extract<RenderLayer, { kind: 'photo' }> => l.kind === 'photo' && !l.element.rotation && !l.element.mask && !l.element.frame
  let split = request.layers.length
  while (split > 0 && placeable(request.layers[split - 1]!)) split--
  type Placed = { input: Buffer | { create: { width: number; height: number; channels: 3; background: string } }; raw?: { width: number; height: number; channels: 4 }; left: number; top: number }
  let placed: Placed[] = []
  let svg: string
  try {
    const onCanvas = (r: { left: number; top: number; width: number; height: number }) =>
      r.left >= 0 && r.top >= 0 && r.left + r.width <= request.width && r.top + r.height <= request.height
    for (const layer of request.layers.slice(split) as Array<Extract<RenderLayer, { kind: 'photo' }>>) {
      const { dest, borderRect, pixels } = await photoPiece(layer, request.border.width)
      if (!onCanvas(dest) || (borderRect && !onCanvas(borderRect))) {
        // Partly off the canvas: the SVG crops it at the edge, so every photo here is drawn there as before.
        placed = []
        split = request.layers.length
        break
      }
      if (borderRect) placed.push({ input: { create: { width: borderRect.width, height: borderRect.height, channels: 3, background: request.border.color } }, left: borderRect.left, top: borderRect.top })
      // Kept with its transparency, so a see-through photo shows the canvas behind it, as it does in the SVG.
      const { data, info } = await pixels.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      placed.push({ input: data, raw: { width: info.width, height: info.height, channels: 4 }, left: dest.left, top: dest.top })
    }
    svg = await canvasSvg({ ...request, layers: request.layers.slice(0, split) })
  } catch {
    return { ok: false, reason: 'unreadable' }
  }

  try {
    // `unlimited`: the SVG is our own, and embeds full-size photo pieces that exceed the parser's default size guard.
    // Drawn once, to raw pixels; any transparency becomes the background colour, on purpose.
    const drawn = await sharp(Buffer.from(svg), { unlimited: true, limitInputPixels: false })
      .flatten({ background: request.background })
      .toColourspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const canvas =
      placed.length === 0
        ? drawn
        : await sharp(drawn.data, { raw: { width: drawn.info.width, height: drawn.info.height, channels: 3 }, limitInputPixels: false })
            .composite(placed.map(({ input, raw, left, top }) => (raw ? { input, raw, left, top } : { input, left, top })))
            .removeAlpha() // compositing adds an alpha channel; the canvas stays three-channel like the drawn one
            .raw()
            .toBuffer({ resolveWithObject: true })
    const raw = { width: canvas.info.width, height: canvas.info.height, channels: canvas.info.channels }
    // Every file is cut from the same pixels and encoded with the same settings, so slides match where they meet.
    const save = async (piece: Sharp, path: string) => {
      if (request.encoding === 'png') return writeFileSync(path, await piece.png().toBuffer())
      // Full-resolution colour (4:4:4): the default stores colour at half resolution, which visibly smears saturated
      // edges such as red petals. mozjpeg's encoder keeps the larger file in check (owner's review, R5).
      const encoded = await piece.jpeg({ quality: request.quality, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer()
      writeFileSync(path, request.ppi ? withPrintDensity(encoded, request.ppi) : encoded)
    }
    let left = 0
    for (const [i, width] of sliceWidths(raw.width, request.outputPaths.length).entries()) {
      await save(sharp(canvas.data, { raw }).extract({ left, top: 0, width, height: raw.height }), request.outputPaths[i]!)
      left += width
    }
    if (request.wholePath) await save(sharp(canvas.data, { raw }), request.wholePath)
    return { ok: true }
  } catch (error: unknown) {
    for (const path of [...request.outputPaths, ...(request.wholePath ? [request.wholePath] : [])]) rmSync(path, { force: true })
    const message = error instanceof Error ? `${error.message} ${'code' in error ? String(error.code) : ''}` : String(error)
    return { ok: false, reason: /ENOSPC|No space left/i.test(message) ? 'disk_full' : 'failed' }
  }
}
