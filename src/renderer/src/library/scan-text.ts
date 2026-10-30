/**
 * Turns scan counts into the plain sentences the Library shows, so skipped files are explained, not hidden (AC2).
 * Kept free of React so unit tests can check the wording directly.
 */

import type { ScanCounts, SourceSummary } from '@shared/ipc-contract'

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** "Scanning: 34 files found, 30 photos added" while a scan runs. */
export function describeProgress(counts: ScanCounts): string {
  const photos = counts.indexed + counts.unchanged
  return `${plural(counts.found, 'file', 'files')} found, ${plural(photos, 'photo', 'photos')} ready`
}

/** "85 photos · 3 identical copies": copies are shown once in the grid, so they're mentioned, not counted twice. */
export function describePictures(source: Pick<SourceSummary, 'pictureCount' | 'duplicateCount'>): string {
  const pictures = plural(source.pictureCount, 'photo', 'photos')
  return source.duplicateCount > 0 ? `${pictures} · ${plural(source.duplicateCount, 'identical copy', 'identical copies')}` : pictures
}

/** Explains every file that didn't become a photo in the Library, or returns null if none were skipped. */
export function describeSkipped(counts: ScanCounts): string | null {
  const is = (n: number) => (n === 1 ? 'is' : 'are')
  const reasons = [
    counts.unsupported > 0 && `${counts.unsupported} ${counts.unsupported === 1 ? 'isn’t a JPEG or PNG photo' : 'aren’t JPEG or PNG photos'} (videos, for example)`,
    counts.corrupt > 0 && `${counts.corrupt} ${is(counts.corrupt)} damaged or couldn’t be decoded`,
    counts.tooLarge > 0 && `${counts.tooLarge} ${counts.tooLarge === 1 ? 'is a photo' : 'are photos'} too large to open safely`,
    counts.unreadable > 0 && `${counts.unreadable} couldn’t be read (check folder permissions)`,
  ].filter((reason): reason is string => typeof reason === 'string')
  const skipped = counts.unsupported + counts.corrupt + counts.tooLarge + counts.unreadable
  if (skipped === 0) return null
  return `${plural(skipped, 'file was', 'files were')} skipped: ${reasons.join('; ')}. Skipped files are left exactly as they are.`
}
