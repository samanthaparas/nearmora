/**
 * Unit tests for the small rules the scanner and thumbnail server rely on:
 * recognising photos by their bytes, folder containment, thumbnail URLs and the skipped-files wording.
 */

import { describe, expect, it } from 'vitest'
import { isSameOrInside } from '../../src/main/library/source-folders'
import { detectMediaType, isHiddenName } from '../../src/main/media/limits'
import { parseThumbnailUrl } from '../../src/main/security/policy'
import { describePictures, describeProgress, describeSkipped } from '../../src/renderer/src/library/scan-text'

const ID = '3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e'
const zero = { found: 0, indexed: 0, unchanged: 0, unsupported: 0, corrupt: 0, tooLarge: 0, unreadable: 0 }

describe('detectMediaType', () => {
  it('recognises JPEG and PNG by their first bytes', () => {
    expect(detectMediaType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1]))).toBe('image/jpeg')
    expect(detectMediaType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
  })

  it('rejects anything else, including empty and truncated headers', () => {
    expect(detectMediaType(Buffer.from('GIF89a'))).toBeNull()
    expect(detectMediaType(Uint8Array.from([0xff, 0xd8]))).toBeNull()
    expect(detectMediaType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(detectMediaType(new Uint8Array())).toBeNull()
  })

  it('treats dot-files as hidden', () => {
    expect(isHiddenName('.DS_Store')).toBe(true)
    expect(isHiddenName('._IMG_0001.jpg')).toBe(true)
    expect(isHiddenName('IMG_0001.jpg')).toBe(false)
  })
})

describe('isSameOrInside', () => {
  it('detects the same folder and folders inside it', () => {
    expect(isSameOrInside('/a/b', '/a/b')).toBe(true)
    expect(isSameOrInside('/a/b', '/a/b/c/d')).toBe(true)
  })

  it('is not fooled by sibling folders with a shared prefix', () => {
    expect(isSameOrInside('/a/b', '/a/bc')).toBe(false)
    expect(isSameOrInside('/a/b/c', '/a/b')).toBe(false)
  })
})

describe('parseThumbnailUrl', () => {
  it('accepts exactly nm-media://thumb/<asset id>', () => {
    expect(parseThumbnailUrl(`nm-media://thumb/${ID}`)).toBe(ID)
  })

  it('lets the URL parser collapse ../ first, leaving only an id, which can only name a picture in the catalog', () => {
    expect(parseThumbnailUrl(`nm-media://thumb/../${ID}`)).toBe(ID)
    expect(parseThumbnailUrl('nm-media://thumb/../../etc/passwd')).toBeNull()
  })

  it.each([
    [`nm-media://thumb/${ID}/extra`],
    [`nm-media://thumb/${ID}?size=big`],
    [`nm-media://original/${ID}`],
    [`app://thumb/${ID}`],
    ['nm-media://thumb/%2Fetc%2Fpasswd'],
    ['not a url'],
  ])('refuses %s', (url) => {
    expect(parseThumbnailUrl(url)).toBeNull()
  })
})

describe('scan wording', () => {
  it('says nothing about skipped files when none were skipped', () => {
    expect(describeSkipped({ ...zero, found: 3, indexed: 3 })).toBeNull()
  })

  it('explains each reason, with singular and plural forms', () => {
    expect(describeSkipped({ ...zero, found: 4, unsupported: 1, corrupt: 2, unreadable: 1 })).toBe(
      '4 files were skipped: 1 isn’t a JPEG or PNG; 2 are damaged or couldn’t be decoded; 1 couldn’t be read (check folder permissions). Skipped files are left exactly as they are.',
    )
    expect(describeSkipped({ ...zero, found: 1, tooLarge: 1 })).toBe(
      '1 file was skipped: 1 is too large to open safely. Skipped files are left exactly as they are.',
    )
  })

  it('counts identical copies once and mentions them separately', () => {
    expect(describePictures({ pictureCount: 5, duplicateCount: 1 })).toBe('5 photos · 1 identical copy')
    expect(describePictures({ pictureCount: 1, duplicateCount: 0 })).toBe('1 photo')
  })

  it('counts unchanged photos as ready during a rescan', () => {
    expect(describeProgress({ ...zero, found: 10, indexed: 2, unchanged: 7 })).toBe('10 files found, 9 photos ready')
  })
})
