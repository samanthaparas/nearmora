/**
 * Draws one output canvas (a collage, one carousel slide, or a seamless carousel's whole design with its cuts marked)
 * from the project's composition, the same element list the export draws (AC7). Uses the large preview image, or the thumbnail when that's
 * not available. It draws the same layers, in the same order, as the export: shapes, art and captions, and photos that
 * may be tilted, on cards or cut to a shape (ADR-0017). A pinch or mouse wheel over a photo zooms that photo.
 */

import { useEffect, useRef } from 'react'
import { placePhoto, type Crop, type Fit, type Rect } from '@shared/layout'
import type { Composition, PhotoElement } from '@shared/studio/compose'
import { layers, type Layer } from '@shared/studio/layers'
import { cutPositions } from '@shared/studio/slices'
import { useWheelZoom } from '../wheel-zoom'

export interface CanvasItem {
  assetId: string
  crop: Crop
  fit: Fit
}

// One image element per photo, shared by every canvas on the screen; falls back to the thumbnail if needed.
const images = new Map<string, Promise<HTMLImageElement>>()
function loadImage(assetId: string): Promise<HTMLImageElement> {
  let pending = images.get(assetId)
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => {
        image.onerror = () => reject(new Error('image unavailable'))
        image.src = `nm-media://thumb/${assetId}`
      }
      image.src = `nm-media://preview/${assetId}`
    })
    images.set(assetId, pending)
  }
  return pending
}

const rectPath = (r: Rect) => `M${r.x} ${r.y}h${r.width}v${r.height}h${-r.width}Z`

// Turns the drawing around a photo's centre by its tilt, as the export's SVG `rotate(angle cx cy)` does.
function turn(context: CanvasRenderingContext2D, e: PhotoElement) {
  if (!e.rotation) return
  const cx = e.rect.x + e.rect.width / 2
  const cy = e.rect.y + e.rect.height / 2
  context.translate(cx, cy)
  context.rotate((e.rotation * Math.PI) / 180)
  context.translate(-cx, -cy)
}

// A shape, line art or caption outline: filled and/or stroked, placed by its transform (translate, rotate, scale).
function drawShape(context: CanvasRenderingContext2D, shape: Extract<Layer, { kind: 'shape' }>) {
  context.save()
  if (shape.at) {
    context.translate(shape.at.x, shape.at.y)
    context.rotate((shape.at.rotate * Math.PI) / 180)
    context.scale(shape.at.scale, shape.at.scale)
  }
  const path = new Path2D(shape.d)
  if (shape.opacity !== undefined) context.globalAlpha = shape.opacity
  if (shape.fill) {
    context.fillStyle = shape.fill
    context.fill(path, shape.fillRule ?? 'nonzero')
  }
  if (shape.stroke) {
    context.strokeStyle = shape.stroke.color
    context.lineWidth = shape.stroke.width
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.stroke(path)
  }
  context.restore()
}

// A photo: turned, on its card, cut to its mask, with its border. A masked photo's border runs along the mask's inside.
function drawPhoto(context: CanvasRenderingContext2D, e: PhotoElement, image: HTMLImageElement, item: CanvasItem, border: Composition['border']) {
  context.save()
  turn(context, e)
  if (e.frame) {
    context.fillStyle = e.frame.color
    context.fillRect(e.rect.x - e.frame.pad, e.rect.y - e.frame.pad, e.rect.width + 2 * e.frame.pad, e.rect.height + 2 * e.frame.pad)
  }
  // The crop is in proportions of the photo, so it means the same on the preview image and the original.
  const place = placePhoto({ width: image.naturalWidth, height: image.naturalHeight }, e.rect, item.crop, item.fit, e.mask ? 0 : border.width)
  if (place.frame) {
    context.fillStyle = border.color
    context.fillRect(place.frame.x, place.frame.y, place.frame.width, place.frame.height)
  }
  if (e.mask) context.clip(new Path2D(e.mask))
  const { src, dest } = place
  context.drawImage(image, src.x, src.y, src.width, src.height, dest.x, dest.y, dest.width, dest.height)
  if (e.mask && border.width > 0) {
    context.strokeStyle = border.color
    context.lineWidth = 2 * border.width
    context.stroke(new Path2D(e.mask))
  }
  context.restore()
}

export function StudioCanvas({ composition, items, canvasIndex, displayWidth, highlight, label, onWheelZoom }: {
  composition: Composition
  /** The project's photos by position; element `slot` numbers index into this. */
  items: readonly CanvasItem[]
  canvasIndex: number
  displayWidth: number
  /** Position of the photo being edited, outlined so it's clear what the controls change. */
  highlight: number | null
  label: string
  /** Pinch or wheel over a photo: its position, and how much to zoom (above 1 zooms in). */
  onWheelZoom?: (position: number, factor: number) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const size = { width: composition.width, height: composition.height }
  const scale = displayWidth / size.width
  const displayHeight = size.height * scale

  // Finds the photo under the pointer, in output pixels; over the margin or a gap the page scrolls instead.
  useWheelZoom(ref, (factor, event) => {
    const canvas = ref.current
    if (!onWheelZoom || !canvas) return false
    const box = canvas.getBoundingClientRect()
    const x = ((event.clientX - box.left) * size.width) / box.width
    const y = ((event.clientY - box.top) * size.height) / box.height
    const hit = composition.elements.find(
      (e) => e.canvas === canvasIndex && x >= e.rect.x && x <= e.rect.x + e.rect.width && y >= e.rect.y && y <= e.rect.y + e.rect.height,
    )
    if (!hit) return false
    onWheelZoom(hit.slot, factor)
    return true
  })

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let cancelled = false
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(displayWidth * ratio)
    canvas.height = Math.round(displayHeight * ratio)
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(scale * ratio, 0, 0, scale * ratio, 0, 0) // draw in output pixels; the transform scales to the screen
    context.fillStyle = composition.background
    context.fillRect(0, 0, size.width, size.height)

    // The same drawing order the export uses (layers.ts); everything is drawn once every photo has loaded or failed.
    const order = layers(composition, canvasIndex)
    const photos = order.flatMap((l) => (l.kind === 'photo' && items[l.element.slot] ? [l.element] : []))
    void Promise.allSettled(photos.map((e) => loadImage(items[e.slot]!.assetId))).then((loaded) => {
      if (cancelled) return
      const imageOf = new Map(photos.map((e, i) => [e.slot, loaded[i]?.status === 'fulfilled' ? loaded[i].value : null]))
      for (const layer of order) {
        if (layer.kind === 'shape') drawShape(context, layer)
        else {
          const image = imageOf.get(layer.element.slot)
          const item = items[layer.element.slot]
          if (image && item) drawPhoto(context, layer.element, image, item, composition.border)
        }
      }
      const selected = composition.elements.find((e) => e.canvas === canvasIndex && e.slot === highlight)
      if (selected) {
        context.save()
        turn(context, selected)
        context.strokeStyle = '#5b414b'
        context.lineWidth = 8 / scale
        context.stroke(new Path2D(selected.mask ?? rectPath(selected.rect)))
        context.restore()
      }
      // A seamless design's cuts, as dashed lines (editor only, never exported): white under plum, so they show on
      // any photo. They come from the same slicing rule the export cuts with.
      for (const x of composition.slices > 1 ? cutPositions(composition.width, composition.slices) : []) {
        context.save()
        context.lineWidth = 3 / scale
        context.setLineDash([12 / scale, 8 / scale])
        for (const [colour, offset] of [['#ffffff', 0], ['#5b414b', 10 / scale]] as const) {
          context.strokeStyle = colour
          context.lineDashOffset = offset
          context.beginPath()
          context.moveTo(x, 0)
          context.lineTo(x, size.height)
          context.stroke()
        }
        context.restore()
      }
    })
    return () => {
      cancelled = true
    }
  }, [composition, items, canvasIndex, displayWidth, displayHeight, scale, size.width, size.height, highlight])

  // Shrinks to fit narrow windows and 200% zoom (no sideways scrolling); the canvas keeps its shape from its pixel size.
  return <canvas ref={ref} className="studio__canvas" role="img" aria-label={label} style={{ width: displayWidth, maxWidth: '100%', height: 'auto' }} />
}
