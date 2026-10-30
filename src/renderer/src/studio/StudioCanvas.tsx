/**
 * Draws one output canvas (a collage, or one carousel slide) from the project's composition, the same element list
 * the export draws (AC7). Uses the large preview image, or the thumbnail when that's
 * not available. Borders and fit-or-fill come from the same placement math as the export. A pinch or mouse wheel over a
 * photo zooms that photo.
 */

import { useEffect, useRef } from 'react'
import { placePhoto, type Crop, type Fit } from '@shared/layout'
import type { Composition } from '@shared/studio/compose'
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

    const mine = composition.elements
      .filter((e) => e.canvas === canvasIndex && items[e.slot])
      .map((e) => ({ cell: e.rect, position: e.slot, item: items[e.slot]! }))
    void Promise.allSettled(mine.map((p) => loadImage(p.item.assetId))).then((loaded) => {
      if (cancelled) return
      mine.forEach((p, i) => {
        const result = loaded[i]
        if (result?.status !== 'fulfilled') return
        const image = result.value
        // The crop is in proportions of the photo, so it means the same on the preview image and the original.
        const place = placePhoto({ width: image.naturalWidth, height: image.naturalHeight }, p.cell, p.item.crop, p.item.fit, composition.border.width)
        if (place.frame) {
          context.fillStyle = composition.border.color
          context.fillRect(place.frame.x, place.frame.y, place.frame.width, place.frame.height)
        }
        const { src, dest } = place
        context.drawImage(image, src.x, src.y, src.width, src.height, dest.x, dest.y, dest.width, dest.height)
      })
      const selected = mine.find((p) => p.position === highlight)
      if (selected) {
        context.strokeStyle = '#5b414b'
        context.lineWidth = 8 / scale
        context.strokeRect(selected.cell.x, selected.cell.y, selected.cell.width, selected.cell.height)
      }
    })
    return () => {
      cancelled = true
    }
  }, [composition, items, canvasIndex, displayWidth, displayHeight, scale, size.width, size.height, highlight])

  // Shrinks to fit narrow windows and 200% zoom (no sideways scrolling); the canvas keeps its shape from its pixel size.
  return <canvas ref={ref} className="studio__canvas" role="img" aria-label={label} style={{ width: displayWidth, maxWidth: '100%', height: 'auto' }} />
}
