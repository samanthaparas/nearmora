/**
 * End-to-end tests of Favorites and Memory Studio (AC6) in the built app: favorite a burst, start collages and a
 * carousel from Favorites, adjust order and crop by keyboard, restart and find the draft exactly as left, see
 * offline photos named, and delete a project with every original untouched.
 */

import { renameSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { generateBurstFolder } from '../tests/support/generate-photos'
import { fingerprintFolder } from '../tests/support/originals-guard'
import { launchApp, tempFolder } from './launch'

let root: string
let profile: string
let before: ReturnType<typeof fingerprintFolder>

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).click()
const cropNote = (page: Page) => page.locator('.studio__adjust .review__note').innerText()

test.beforeAll(async () => {
  root = (await generateBurstFolder(join(tempFolder('photos'), 'Burst'), 5)).root
  before = fingerprintFolder(root)
  profile = tempFolder('profile')
  const { app } = await launchApp(profile)
  const page = await app.firstWindow()
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
  }, root)
  await page.getByRole('button', { name: 'Add folder' }).click()
  await expect(page.locator('p', { hasText: 'Burst · 6 photos' })).toBeVisible({ timeout: 20_000 })
  // Favorite all five burst photos in Best Moments.
  await nav(page, 'Best Moments')
  await page.locator('.moments__card').first().click()
  await page.getByRole('button', { name: 'Favorite all' }).click()
  await page.getByRole('button', { name: 'Save choices' }).click()
  await expect(page.getByText('Saved: 5 favorites.')).toBeVisible()
  await app.close()
})

test.afterAll(() => {
  expect(fingerprintFolder(root)).toEqual(before)
})

test('a collage made from Favorites keeps its order, crop, shape and title after a restart (keyboard only)', async () => {
  let { app } = await launchApp(profile)
  let page = await app.firstWindow()
  await nav(page, 'Favorites')
  await expect(page.getByRole('list', { name: 'Favorites, 5 in total' })).toBeVisible()
  const pick = page.getByRole('button', { name: /^Select: / })
  await pick.nth(0).click()
  await expect(page.getByRole('button', { name: /Equal split/ })).toBeDisabled()
  await pick.nth(1).click()
  await page.getByRole('button', { name: /Equal split/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Equal split' })).toBeVisible()
  await expect(page.getByRole('img', { name: /Preview: equal split, square, cream background/ })).toBeVisible()

  // Keyboard only: focus a crop button, then use arrow keys and + inside the controls group.
  await page.getByRole('button', { name: 'Show more of the right' }).focus()
  await page.keyboard.press('+')
  await page.keyboard.press('+')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByText('All changes saved', { exact: false })).toBeVisible()
  await expect.poll(() => cropNote(page)).toContain('zoom 150%')
  const firstPhotoCrop = await cropNote(page)

  await page.getByRole('button', { name: 'Move later' }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => cropNote(page)).toContain('Photo 2 of 2')
  // The radio reflects the saved project, so it shows as checked once main confirms the change.
  await page.getByLabel('Portrait (1080 × 1350)').click()
  await expect(page.getByLabel('Portrait (1080 × 1350)')).toBeChecked()
  await page.getByLabel('Title').fill('Garden pair')
  await page.getByRole('button', { name: 'Save title' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Garden pair' })).toBeVisible()
  await app.close()

  ;({ app } = await launchApp(profile))
  page = await app.firstWindow()
  await nav(page, 'Memory Studio')
  await page.getByRole('button', { name: /Garden pair/ }).click()
  await expect(page.getByRole('img', { name: /portrait, cream background/ })).toBeVisible()
  // The moved photo (now second) still has the crop it was given.
  await page.getByRole('button', { name: 'Adjust photo 2' }).click()
  expect((await cropNote(page)).replace('Photo 2 of 2', 'Photo 1 of 2')).toBe(firstPhotoCrop)
  await app.close()
})

test('a carousel gets one preview per slide, and offline photos are named before export', async () => {
  const { app } = await launchApp(profile)
  const page = await app.firstWindow()
  await nav(page, 'Favorites')
  const pick = page.getByRole('button', { name: /^Select: / })
  for (let i = 0; i < 5; i++) await pick.nth(i).click()
  await page.getByRole('button', { name: /Carousel/ }).click()
  await expect(page.getByRole('img', { name: /Preview of slide \d of 5/ })).toHaveCount(5)

  const parked = `${root}-unplugged`
  renameSync(root, parked) // the test's own folder goes offline
  try {
    await nav(page, 'Library') // listing sources notices the folder is gone
    await expect(page.getByText('Not connected.', { exact: false })).toBeVisible()
    await nav(page, 'Memory Studio')
    await page.getByRole('button', { name: /Carousel/ }).first().click()
    await expect(page.getByText('5 photos are offline')).toBeVisible()
    await expect(page.getByText('burst-1.jpg (in “Burst”)', { exact: false })).toBeVisible()
  } finally {
    renameSync(parked, root)
  }
  await app.close()
})

test('deleting a project asks first, and the photos stay', async () => {
  const { app } = await launchApp(profile)
  const page = await app.firstWindow()
  await nav(page, 'Memory Studio')
  await page.getByRole('button', { name: /Garden pair/ }).click()
  await page.getByRole('button', { name: 'Delete project…' }).click()
  await expect(page.getByRole('button', { name: 'Keep project' })).toBeFocused()
  await page.getByRole('button', { name: 'Delete project', exact: true }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Your projects' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Garden pair/ })).toHaveCount(0)
  await nav(page, 'Favorites')
  await expect(page.getByRole('list', { name: 'Favorites, 5 in total' })).toBeVisible()
  await app.close()
})

test('a landscape collage, and a mouse wheel over a photo zooms that photo and saves it', async () => {
  const { app } = await launchApp(profile)
  const page = await app.firstWindow()
  await nav(page, 'Favorites')
  const pick = page.getByRole('button', { name: /^Select: / })
  await pick.nth(0).click()
  await pick.nth(1).click()
  await page.getByRole('button', { name: /Equal split/ }).click()

  await page.getByLabel('Landscape (1350 × 1080)').click()
  await expect(page.getByLabel('Landscape (1350 × 1080)')).toBeChecked()
  await expect(page.getByRole('img', { name: /Preview: equal split, landscape, cream background/ })).toBeVisible()
  await expect(page.getByText('JPEG, 1350 × 1080 pixels, 1 file')).toBeVisible()

  // Wheel over the right-hand photo: it becomes the photo being adjusted, and zooms in.
  // The preview takes its new shape a moment after the label changes, and may sit outside the window on a small
  // screen: bring it into view and wait for landscape proportions before pointing at it.
  const canvas = page.getByRole('img', { name: /Preview: equal split/ })
  await canvas.scrollIntoViewIfNeeded()
  await expect.poll(async () => {
    const b = await canvas.boundingBox()
    return b ? Math.round((b.width / b.height) * 100) : 0
  }).toBe(125)
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2)
  await page.mouse.wheel(0, -200)
  await expect.poll(() => cropNote(page)).toContain('Photo 2 of 2')
  await expect.poll(() => cropNote(page)).not.toContain('zoom 100%')
  await expect(page.getByText('All changes saved', { exact: false })).toBeVisible()
  const zoomed = await cropNote(page)

  // Saved: reopening the project shows the same crop.
  await page.getByRole('button', { name: '← All projects' }).click()
  await page.getByRole('button', { name: /Equal split/ }).first().click()
  await page.getByRole('button', { name: 'Adjust photo 2' }).click()
  expect(await cropNote(page)).toBe(zoomed)
  await app.close()
})

test('new projects start from a template: Stacked puts two photos one above the other, and its name shows on the card', async () => {
  const { app } = await launchApp(profile)
  const page = await app.firstWindow()
  await nav(page, 'Favorites')
  const pick = page.getByRole('button', { name: /^Select: / })
  await pick.nth(0).click()
  await pick.nth(1).click()
  // Only templates that fit two photos are enabled.
  await expect(page.getByRole('button', { name: /^Classic grid/ })).toBeDisabled()
  await page.getByRole('button', { name: /^Stacked/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Stacked' })).toBeVisible()
  await expect(page.getByRole('img', { name: /Preview: stacked, square, cream background/ })).toBeVisible()
  await expect(page.getByText('Stacked · 2 photos · 1080 × 1080')).toBeVisible()
  await page.getByRole('button', { name: '← All projects' }).click()
  await expect(page.getByRole('button', { name: /Stacked · 2 photos/ })).toBeVisible()
  await app.close()
})

test('the picker groups every everyday layout with a drawing, and the editor switches layout keeping the photos', async () => {
  const { app } = await launchApp(profile)
  const page = await app.firstWindow()
  await nav(page, 'Favorites')
  const twoPhotos = page.getByRole('region', { name: 'Two photos' })
  const fourPhotos = page.getByRole('region', { name: 'Four photos' })
  await expect(twoPhotos.getByRole('button')).toHaveCount(8)
  await expect(fourPhotos.getByRole('button')).toHaveCount(10)
  // Nothing selected: nothing enabled. Four selected: only four-photo layouts and the carousel.
  await expect(fourPhotos.getByRole('button', { name: /^Lead \+ three/ })).toBeDisabled()
  const pick = page.getByRole('button', { name: /^Select: / })
  for (let i = 0; i < 4; i++) await pick.nth(i).click()
  await expect(twoPhotos.getByRole('button', { name: /^Wide gutter/ })).toBeDisabled()
  await fourPhotos.getByRole('button', { name: /^Lead \+ three/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Lead + three' })).toBeVisible()
  await expect(page.getByRole('img', { name: /Preview: lead \+ three, square, cream background/ })).toBeVisible()

  // Switch layout in the editor: the photos stay, in the same order, and the change is saved.
  const layouts = page.getByRole('region', { name: 'Layout' })
  await expect(layouts.getByRole('button', { name: 'Lead + three' })).toHaveAttribute('aria-pressed', 'true')
  await expect(layouts.getByRole('button', { name: 'Equal split' })).toHaveCount(0) // only layouts for four photos
  await layouts.getByRole('button', { name: 'Offset grid' }).click()
  await expect(page.getByText('Layout changed to Offset grid. All changes saved.')).toBeVisible()
  await expect(page.getByRole('img', { name: /Preview: offset grid, square/ })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Photos in this project, in order' }).getByRole('button')).toHaveCount(4)
  await page.getByRole('button', { name: '← All projects' }).click()
  await expect(page.getByRole('button', { name: /Offset grid · 4 photos/ })).toBeVisible()
  await app.close()
})
