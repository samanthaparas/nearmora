/**
 * Builds a small folder of generated test photos covering the cases a scan must handle:
 * dates, rotation, PNGs, nested folders, an identical copy, and files that must be skipped.
 * Generated at test time, so no image files live in the repository and CI needs no private fixtures.
 */

import { copyFileSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

export interface GeneratedFolder {
  root: string
  /** What a correct scan of this folder must report. */
  expected: { found: number; indexed: number; distinctPhotos: number; unsupported: number; corrupt: number }
}

// A distinct picture per call: a two-colour split at a different position, so every file has different bytes and dHash.
async function photo(width: number, height: number, split: number, colors: [string, string]) {
  const left = await sharp({ create: { width: Math.max(1, Math.round(width * split)), height, channels: 3, background: colors[0] } }).png().toBuffer()
  return sharp({ create: { width, height, channels: 3, background: colors[1] } }).composite([{ input: left, left: 0, top: 0 }])
}

export async function generatePhotoFolder(root: string): Promise<GeneratedFolder> {
  mkdirSync(join(root, 'nested', 'deeper'), { recursive: true })
  mkdirSync(join(root, 'copies'))

  // Dated JPEG.
  await (await photo(64, 48, 0.3, ['#5b414b', '#e8b7b0']))
    .jpeg()
    .withExif({ IFD2: { DateTimeOriginal: '2024:05:06 07:08:09' } })
    .toFile(join(root, 'dated.jpg'))
  // Stored sideways (64×48) with EXIF orientation 6, so it displays 48×64.
  await (await photo(64, 48, 0.6, ['#b8bda6', '#5b414b']))
    .jpeg()
    .withExif({ IFD2: { DateTimeOriginal: '2023:01:02 03:04:05' } })
    .withMetadata({ orientation: 6 })
    .toFile(join(root, 'rotated.jpg'))
  // PNG with no date at all: falls back to the file's modification time.
  await (await photo(40, 40, 0.5, ['#e8b7b0', '#b9a4c8'])).png().toFile(join(root, 'screenshot.png'))
  await (await photo(32, 48, 0.2, ['#7a6570', '#b8bda6'])).jpeg().toFile(join(root, 'nested', 'nested.jpg'))
  await (await photo(48, 32, 0.8, ['#5b414b', '#b9a4c8'])).jpeg().toFile(join(root, 'nested', 'deeper', 'deep.jpg'))

  // Byte-identical copy in another folder: one picture, two locations.
  copyFileSync(join(root, 'dated.jpg'), join(root, 'copies', 'dated-copy.jpg'))

  // Not photos: plain text, and text renamed to .jpg (judged by content, not extension).
  writeFileSync(join(root, 'notes.txt'), 'not a photo')
  writeFileSync(join(root, 'renamed.jpg'), 'also not a photo')
  // Damaged: correct signatures followed by garbage.
  writeFileSync(join(root, 'truncated.jpg'), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]))
  writeFileSync(join(root, 'broken.png'), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 3)]))

  // Ignored entirely: hidden files and symlinks are neither indexed nor counted.
  writeFileSync(join(root, '.DS_Store'), 'hidden')
  symlinkSync(join(root, 'dated.jpg'), join(root, 'link.jpg'))

  return { root, expected: { found: 10, indexed: 6, distinctPhotos: 5, unsupported: 2, corrupt: 2 } }
}

/**
 * A burst: `count` near-identical shots (the same scene with tiny brightness changes), taken a second apart with
 * EXIF dates, plus one different photo taken a minute later. Best Moments should group the burst and leave the
 * other photo out.
 */
export async function generateBurstFolder(root: string, count = 3): Promise<{ root: string; burstFiles: string[]; otherFile: string }> {
  mkdirSync(root, { recursive: true })
  const scene = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#b8bda6' } })
    .composite([
      { input: await sharp({ create: { width: 120, height: 160, channels: 3, background: '#5b414b' } }).png().toBuffer(), left: 40, top: 40 },
      { input: await sharp({ create: { width: 90, height: 60, channels: 3, background: '#e8b7b0' } }).png().toBuffer(), left: 200, top: 140 },
    ])
    .png()
    .toBuffer()
  const burstFiles: string[] = []
  for (let i = 0; i < count; i++) {
    const name = `burst-${i + 1}.jpg`
    await sharp(scene)
      .modulate({ brightness: 1 + i * 0.02 })
      .jpeg()
      .withExif({ IFD2: { DateTimeOriginal: `2024:07:20 10:00:0${i}` } })
      .toFile(join(root, name))
    burstFiles.push(name)
  }
  await sharp(scene)
    .flop()
    .negate({ alpha: false })
    .jpeg()
    .withExif({ IFD2: { DateTimeOriginal: '2024:07:20 10:01:00' } })
    .toFile(join(root, 'other.jpg'))
  return { root, burstFiles, otherFile: 'other.jpg' }
}
