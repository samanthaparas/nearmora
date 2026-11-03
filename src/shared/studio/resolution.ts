/**
 * Effective resolution for print sizes: how many of the photo's own pixels land on each printed inch, after the crop,
 * zoom, fit and border. A photo that is enlarged a lot looks soft on paper, so the editor warns before export.
 * The thresholds are Nearmora's own guide (300 is the target the print sizes are built on), not any print service's rule.
 */

import { placePhoto, type Crop, type Fit } from '../layout'
import type { Composition } from './compose'
import { FORMATS, PRINT_PPI, type FormatId } from './formats'

/** At or above this, prints should look sharp at normal viewing distance. */
export const GOOD_PPI = 200
/** Below this, softness is likely to be visible. Between the two, it may show up close. */
export const LOW_PPI = 150

export type Sharpness = 'good' | 'fair' | 'low'

export interface PhotoResolution {
  /** The project's photo position. */
  slot: number
  /** The photo's pixels per printed inch, rounded down. */
  ppi: number
  sharpness: Sharpness
}

export const sharpnessOf = (ppi: number): Sharpness => (ppi >= GOOD_PPI ? 'good' : ppi >= LOW_PPI ? 'fair' : 'low')

/**
 * Each photo's effective resolution at a print size, or an empty list for sharing sizes. Photos whose size isn't
 * known yet (not scanned) are left out rather than guessed.
 */
export function printResolution(
  composition: Composition,
  format: FormatId,
  items: ReadonlyArray<{ width: number | null; height: number | null; crop: Crop; fit: Fit }>,
): PhotoResolution[] {
  if (FORMATS[format].use !== 'print') return []
  return composition.elements.flatMap((element) => {
    const item = items[element.slot]
    // Hidden photos aren't printed, and empty places (S6a) have no photo.
    if (element.hidden || !item?.width || !item.height) return []
    const place = placePhoto({ width: item.width, height: item.height }, element.rect, item.crop, item.fit, composition.border.width)
    // Output pixels are printed at PRINT_PPI, so photo pixels per output pixel × PRINT_PPI is photo pixels per inch.
    const ppi = Math.floor((place.src.width / place.dest.width) * PRINT_PPI)
    return [{ slot: element.slot, ppi, sharpness: sharpnessOf(ppi) }]
  })
}
