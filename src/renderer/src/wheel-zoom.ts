/**
 * Zooming with a trackpad pinch or a mouse wheel, shared by Memory Studio and Best Moments.
 * On a Mac a pinch arrives as a wheel event with the Ctrl key set, so one listener handles both.
 */

import { useEffect, useRef, type RefObject } from 'react'

/** How much one wheel event zooms: above 1 zooms in. Pinches send small steps, so they're scaled up more. */
export function wheelZoomFactor(event: Pick<WheelEvent, 'deltaY' | 'ctrlKey'>): number {
  return Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002))
}

/**
 * Calls `onZoom` for wheel and pinch events over the element. React's onWheel is passive and can't stop the page
 * from scrolling at the same time, so the listener is added directly. `onZoom` returns false to leave an event
 * alone (for example, over the gap between photos), and the page then scrolls as usual.
 */
export function useWheelZoom(ref: RefObject<HTMLElement | null>, onZoom: (factor: number, event: WheelEvent) => boolean | void): void {
  const latest = useRef(onZoom)
  useEffect(() => {
    latest.current = onZoom
  })
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const listener = (event: WheelEvent) => {
      if (event.deltaY === 0) return
      if (latest.current(wheelZoomFactor(event), event) !== false) event.preventDefault()
    }
    element.addEventListener('wheel', listener, { passive: false })
    return () => element.removeEventListener('wheel', listener)
  }, [ref])
}
