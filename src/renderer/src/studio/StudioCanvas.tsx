/**
 * Draws one output canvas (a collage, one carousel slide, or a seamless carousel's whole design with its cuts marked)
 * from the project's composition, the same element list the export draws (AC7). Uses the large preview image, or the thumbnail when that's
 * not available. It draws the same layers, in the same order, as the export: shapes, art and captions, and photos that
 * may be tilted, on cards or cut to a shape (ADR-0017). A pinch or mouse wheel over a photo zooms that photo.
 */

import { useEffect, useRef, type PointerEvent } from 'react'
import { placePhoto, type Crop, type Fit, type Rect } from '@shared/layout'
import type { Composition, PhotoElement } from '@shared/studio/compose'
import { layers, type Layer } from '@shared/studio/layers'
import { cutPositions } from '@shared/studio/slices'
import type { Guide } from '@shared/studio/snap'
import { useWheelZoom } from '../wheel-zoom'

export interface CanvasItem {
  /** Null for an emptied place (S6a): the editor draws a placeholder there; posted slides show the background. */
  assetId: string | null
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
  // A flipped photo (S6a) is mirrored left to right within its place, as the export's sharp `flop` does.
  if (e.flip) {
    context.translate(2 * dest.x + dest.width, 0)
    context.scale(-1, 1)
  }
  context.drawImage(image, src.x, src.y, src.width, src.height, dest.x, dest.y, dest.width, dest.height)
  if (e.flip) {
    context.scale(-1, 1)
    context.translate(-(2 * dest.x + dest.width), 0)
  }
  if (e.mask && border.width > 0) {
    context.strokeStyle = border.color
    context.lineWidth = 2 * border.width
    context.stroke(new Path2D(e.mask))
  }
  context.restore()
}

/** A drag on the preview (S6a): which photo, moving it or resizing it by its corner, and how far, in canvas pixels. */
export interface Drag {
  slot: number
  kind: 'move' | 'resize'
  dx: number
  dy: number
  /** True on the last report, when the pointer is let go. */
  done: boolean
  /** ⌘ held: place it freely, without snapping. */
  free: boolean
}

/** How close to a photo's bottom-right corner (in screen pixels) a press resizes it instead of moving it. */
const HANDLE = 18

export function StudioCanvas({ composition, items, canvasIndex, displayWidth, highlight, label, onWheelZoom, guides = true, placeholders = true, onSelect, onDrag, snapGuides = [] }: {
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
  /** Draw a seamless design's cut guides (the swipe preview turns them off, to show the slides as posted). */
  guides?: boolean
  /** Mark empty places with a dashed outline (editor only; the swipe preview shows them as posted, empty). */
  placeholders?: boolean
  /** A press on a photo selects it (S6a). */
  onSelect?: (slot: number) => void
  /** Dragging a selected, unlocked photo moves it, or resizes it from its bottom-right corner (S6a). */
  onDrag?: (drag: Drag) => void
  /** Lines the dragged photo snapped to, drawn while dragging (editor only). */
  snapGuides?: readonly Guide[]
}) {
  // The drag in progress: where it started, in canvas pixels.
  const dragging = useRef<{ slot: number; kind: Drag['kind']; x: number; y: number; moved: boolean } | null>(null)
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
    const photos = order.flatMap((l) => (l.kind === 'photo' && items[l.element.slot]?.assetId ? [l.element] : []))
    void Promise.allSettled(photos.map((e) => loadImage(items[e.slot]!.assetId!))).then((loaded) => {
      if (cancelled) return
      const imageOf = new Map(photos.map((e, i) => [e.slot, loaded[i]?.status === 'fulfilled' ? loaded[i].value : null]))
      for (const layer of order) {
        if (layer.kind === 'shape') drawShape(context, layer)
        else {
          const image = imageOf.get(layer.element.slot)
          const item = items[layer.element.slot]
          if (image && item) drawPhoto(context, layer.element, image, item, composition.border)
          // An emptied place: a dashed outline, editor only, so it can be found and filled again.
          else if (item && item.assetId === null && placeholders) {
            context.save()
            turn(context, layer.element)
            context.setLineDash([16 / scale, 10 / scale])
            context.lineWidth = 3 / scale
            context.strokeStyle = '#7a6570'
            context.stroke(new Path2D(layer.element.mask ?? rectPath(layer.element.rect)))
            context.restore()
          }
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
      // Snap guides while a photo is dragged (editor only): the canvas edge, centre or other photo it lines up with.
      for (const guide of snapGuides) {
        context.save()
        context.strokeStyle = '#b05a7a'
        context.lineWidth = 2 / scale
        context.beginPath()
        if (guide.axis === 'x') {
          context.moveTo(guide.at, 0)
          context.lineTo(guide.at, size.height)
        } else {
          context.moveTo(0, guide.at)
          context.lineTo(size.width, guide.at)
        }
        context.stroke()
        context.restore()
      }
      // A seamless design's cuts, as dashed lines (editor only, never exported): white under plum, so they show on
      // any photo. They come from the same slicing rule the export cuts with.
      for (const x of guides && composition.slices > 1 ? cutPositions(composition.width, composition.slices) : []) {
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
  }, [composition, items, canvasIndex, displayWidth, displayHeight, scale, size.width, size.height, highlight, guides, placeholders, snapGuides])

  // Pointer position in canvas pixels (the canvas may be shown smaller than its width when the window is narrow).
  const at = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: ((event.clientX - box.left) * size.width) / box.width, y: ((event.clientY - box.top) * size.height) / box.height, perPixel: size.width / box.width }
  }
  const interactive = Boolean(onSelect || onDrag)
  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (!interactive || event.button !== 0) return
    const p = at(event)
    // The front-most visible photo under the pointer (tilt is ignored for picking; the outline shows what was picked).
    const hit = [...composition.elements]
      .reverse()
      .find((e) => e.canvas === canvasIndex && !e.hidden && p.x >= e.rect.x && p.x <= e.rect.x + e.rect.width && p.y >= e.rect.y && p.y <= e.rect.y + e.rect.height)
    if (!hit) return
    onSelect?.(hit.slot)
    if (hit.locked || !onDrag) return
    const corner = Math.hypot(hit.rect.x + hit.rect.width - p.x, hit.rect.y + hit.rect.height - p.y) <= HANDLE * p.perPixel
    dragging.current = { slot: hit.slot, kind: corner ? 'resize' : 'move', x: p.x, y: p.y, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragging.current
    if (!drag || !onDrag) return
    const p = at(event)
    drag.moved = true
    onDrag({ slot: drag.slot, kind: drag.kind, dx: p.x - drag.x, dy: p.y - drag.y, done: false, free: event.metaKey })
  }
  function onPointerUp(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragging.current
    dragging.current = null
    if (!drag || !onDrag || !drag.moved) return
    const p = at(event)
    onDrag({ slot: drag.slot, kind: drag.kind, dx: p.x - drag.x, dy: p.y - drag.y, done: true, free: event.metaKey })
  }

  // Shrinks to fit narrow windows and 200% zoom (no sideways scrolling); the canvas keeps its shape from its pixel size.
  return (
    <canvas
      ref={ref}
      className={`studio__canvas${interactive ? ' studio__canvas--arrange' : ''}`}
      role="img"
      aria-label={label}
      style={{ width: displayWidth, maxWidth: '100%', height: 'auto' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}
