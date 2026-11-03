/**
 * End-to-end tests of Favorites and Memory Studio (AC6) in the built app: favorite a burst, start collages and a
 * carousel from Favorites (including playful pairs and quartets), adjust order and crop by keyboard, restart and find the draft exactly as left, see
 * offline photos named, and delete a project with every original untouched.
 */

import { readdirSync, renameSync } from 'node:fs'
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

// The offline test unplugs the folder; it stays "not connected" until reconnected, and export needs it. This waits for
// the folder's status line, whichever state it's in, then reconnects only if needed.
async function ensureConnected(page: Page) {
  await nav(page, 'Library')
  await expect(page.locator('.library__source').first()).toBeVisible()
  const reconnect = page.getByRole('button', { name: 'Reconnect' })
  if ((await reconnect.count()) > 0) {
    await reconnect.click()
    await expect(page.locator('p', { hasText: 'Burst · 6 photos' })).toBeVisible({ timeout: 20_000 })
  }
}

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

test('Quick edits: colour, spacing, border, fit, swap and replace, each undoable, and all kept after a restart', async () => {
  let { app } = await launchApp(profile)
  let page = await app.firstWindow()
  await nav(page, 'Favorites')
  const pick = page.getByRole('button', { name: /^Select: / })
  await pick.nth(2).click()
  await pick.nth(3).click()
  await page.getByRole('button', { name: /^Quiet frame/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Quiet frame' })).toBeVisible()
  const undoButton = page.getByRole('button', { name: 'Undo', exact: true })
  await expect(undoButton).toBeDisabled()
  const thumbs = () => page.getByRole('list', { name: 'Photos in this project, in order' }).locator('img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('src')))
  const startOrder = await thumbs()

  // A named background swatch, then a border made by keyboard on the slider (one undo step for the whole move).
  await page.getByRole('group', { name: 'Background' }).getByRole('radio', { name: 'Charcoal' }).check()
  await expect(page.getByText('Background changed. All changes saved.')).toBeVisible()
  await page.getByRole('slider', { name: 'Border width' }).focus()
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
  await expect(page.getByText('Border width changed. All changes saved.')).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Border width' })).toHaveValue('12')
  await expect(page.getByRole('img', { name: /Preview: quiet frame, square, charcoal background, white border/ })).toBeVisible()
  await page.getByRole('slider', { name: 'Margin' }).fill('40')
  await expect(page.getByText('Margin changed. All changes saved.')).toBeVisible()

  // Photo 2 shows whole; its crop controls switch off. Then the two photos swap places.
  await page.getByRole('button', { name: 'Adjust photo 2' }).click()
  await page.getByRole('radio', { name: 'Show the whole photo' }).check()
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
  await page.getByRole('button', { name: 'Swap with photo 1' }).click()
  await expect(page.getByText('Swapped photos 2 and 1. All changes saved.')).toBeVisible()
  expect(await thumbs()).toEqual([...startOrder].reverse())
  // The whole-photo setting travelled with its photo, now first and selected.
  await expect(page.getByRole('radio', { name: 'Show the whole photo' })).toBeChecked()

  // Undo by button and by ⌘Z, then redo by ⇧⌘Z.
  await undoButton.click()
  await expect(page.getByText('Undone: swapped photos 2 and 1. All changes saved.')).toBeVisible()
  expect(await thumbs()).toEqual(startOrder)
  await page.getByRole('heading', { level: 3, name: 'Layout' }).click() // focus leaves the controls entirely
  await page.keyboard.press('Meta+z')
  await expect(page.getByText('Undone: whole photo shown. All changes saved.')).toBeVisible()
  await page.keyboard.press('Meta+Shift+z')
  await expect(page.getByText('Redone: whole photo shown. All changes saved.')).toBeVisible()

  // Replace photo 1 with another favorite: the choices leave out photos already in the project.
  await page.getByRole('button', { name: 'Adjust photo 1' }).click()
  await page.getByRole('button', { name: 'Replace…' }).click()
  const choices = page.getByRole('group', { name: 'Replace photo 1 with a favorite' }).getByRole('button', { name: /^Use / })
  await expect(choices).toHaveCount(3)
  await choices.first().click()
  await expect(page.getByText('Replaced photo 1. All changes saved.')).toBeVisible()
  const edited = await thumbs()
  expect(edited[0]).not.toBe(startOrder[0])
  await app.close()

  // After a restart: everything is as it was left. (The undo list starts fresh in each session.)
  ;({ app } = await launchApp(profile))
  page = await app.firstWindow()
  await nav(page, 'Memory Studio')
  await page.getByRole('button', { name: /Quiet frame/ }).first().click()
  await expect(page.getByRole('img', { name: /charcoal background, white border/ })).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Border width' })).toHaveValue('12')
  await expect(page.getByRole('slider', { name: 'Margin' })).toHaveValue('40')
  expect(await thumbs()).toEqual(edited)
  await page.getByRole('button', { name: 'Adjust photo 2' }).click()
  await expect(page.getByRole('radio', { name: 'Show the whole photo' })).toBeChecked()

  // Reset goes back to the layout's own look and keeps the photos; it can be undone too.
  await page.getByRole('button', { name: 'Reset to layout defaults' }).click()
  await expect(page.getByRole('img', { name: /Preview: quiet frame, square, cream background$/ })).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Margin' })).toHaveValue('140')
  expect(await thumbs()).toEqual(edited)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('img', { name: /charcoal background, white border/ })).toBeVisible()
  await app.close()
})

test('sharing and print sizes: small photos are named before a print export, and tall shapes fit the preview', async () => {
  const { app } = await launchApp(profile)
  const page = await app.firstWindow()
  await nav(page, 'Favorites')
  const pick = page.getByRole('button', { name: /^Select: / })
  await pick.nth(0).click()
  await pick.nth(1).click()
  await page.getByRole('button', { name: /^Equal split/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Equal split' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Shape for sharing' }).getByRole('radio')).toHaveCount(5)
  await expect(page.getByRole('group', { name: /^Print size/ }).getByRole('radio')).toHaveCount(5)
  // Sharing sizes never warn, however small the photos are.
  await expect(page.getByText(/about \d+ pixels per inch/)).toHaveCount(0)

  // The test photos are 320 × 240, far too small for an 8 × 10 in print: both are named, with what can help.
  await page.getByLabel('Print 8 × 10 in (2400 × 3000)').check()
  await expect(page.getByText('Size changed. All changes saved.')).toBeVisible()
  await expect(page.getByText('Some photos may look blurry at this print size')).toBeVisible()
  await expect(page.getByText(/^Photo 1: about \d+ pixels per inch, likely to look blurry$/)).toBeVisible()
  await expect(page.getByText(/^Photo 2: about \d+ pixels per inch, likely to look blurry$/)).toBeVisible()
  await expect(page.getByText('JPEG, 2400 × 3000 pixels, 1 file')).toBeVisible()
  await expect.poll(() => cropNote(page)).toMatch(/prints at about \d+ pixels per inch/)

  // Back to a sharing size: the warning goes. Vertical is drawn narrower so the whole 9 : 16 canvas fits.
  await page.getByLabel('Vertical (1080 × 1920)').check()
  await expect(page.getByText('Some photos may look blurry at this print size')).toHaveCount(0)
  const canvas = page.getByRole('img', { name: /Preview: equal split, vertical/ })
  await expect.poll(async () => {
    const b = await canvas.boundingBox()
    return b ? [Math.round(b.width), Math.round(b.height)] : null
  }).toEqual([315, 560])
  await app.close()
})

test('playful pairs: picked from their own group, with an editable caption that is undoable and kept after a restart', async () => {
  let { app } = await launchApp(profile)
  let page = await app.firstWindow()
  await nav(page, 'Favorites')
  const playful = page.getByRole('region', { name: 'Playful pairs' })
  await expect(playful.getByRole('button')).toHaveCount(10)
  const pick = page.getByRole('button', { name: /^Select: / })
  await pick.nth(0).click()
  await pick.nth(1).click()
  await playful.getByRole('button', { name: /^Postcards/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Postcards' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Preview: postcards, square, cream background, caption “Good food, happier people”' })).toBeVisible()

  // Type a new caption: the preview's description follows, and the edit is saved as one undo step.
  const caption = page.getByLabel('Caption', { exact: true })
  await expect(caption).toHaveValue('Good food, happier people')
  await caption.fill('Lisbon, last June')
  await expect(page.getByText('Caption changed. All changes saved.')).toBeVisible()
  // Typing within 300 ms of the last change joins the same undo step; wait for this one to stand on its own.
  await page.waitForTimeout(400)
  await expect(page.getByRole('img', { name: /caption “Lisbon, last June”$/ })).toBeVisible()
  // A character the handwriting font can't draw is named, not silently shown as a box.
  await caption.fill('Lisbon ♡')
  await expect(page.getByText('The caption font can’t draw ♡, so it is left out.')).toBeVisible()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(caption).toHaveValue('Lisbon, last June')
  await app.close()

  ;({ app } = await launchApp(profile))
  page = await app.firstWindow()
  await nav(page, 'Memory Studio')
  await page.getByRole('button', { name: /Postcards/ }).first().click()
  await expect(page.getByLabel('Caption', { exact: true })).toHaveValue('Lisbon, last June')
  // Switching to another playful pair keeps the photos; that layout has no caption field.
  await page.getByRole('region', { name: 'Layout' }).getByRole('button', { name: 'Circle story' }).click()
  await expect(page.getByText('Layout changed to Circle story. All changes saved.')).toBeVisible()
  await expect(page.getByRole('img', { name: /^Preview: circle story, square, cream background$/ })).toBeVisible()
  await expect(page.getByLabel('Caption', { exact: true })).toHaveCount(0)
  await app.close()
})

test('playful quartets: four photos in their own group, a label per photo that is undoable and kept after a restart', async () => {
  let { app } = await launchApp(profile)
  let page = await app.firstWindow()
  await nav(page, 'Favorites')
  const quartets = page.getByRole('region', { name: 'Playful quartets' })
  await expect(quartets.getByRole('button')).toHaveCount(10)
  const pick = page.getByRole('button', { name: /^Select: / })
  for (const i of [0, 1, 2, 3]) await pick.nth(i).click()
  await quartets.getByRole('button', { name: /^Four seasons/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Four seasons' })).toBeVisible()

  // Each photo has its own label field; a change is one undo step.
  await expect(page.getByLabel('First label', { exact: true })).toHaveValue('spring')
  await expect(page.getByLabel('Fourth label', { exact: true })).toHaveValue('winter')
  const third = page.getByLabel('Third label', { exact: true })
  await third.fill('Porto')
  await expect(page.getByText('Third label changed. All changes saved.')).toBeVisible()
  await page.waitForTimeout(400) // let this change stand as its own undo step
  await third.fill('Porto, rainy')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(third).toHaveValue('Porto')
  await app.close()

  ;({ app } = await launchApp(profile))
  page = await app.firstWindow()
  await nav(page, 'Memory Studio')
  await page.getByRole('button', { name: /Four seasons/ }).first().click()
  await expect(page.getByLabel('Third label', { exact: true })).toHaveValue('Porto')
  // Switching to another playful quartet keeps the four photos; that layout has no labels.
  await page.getByRole('region', { name: 'Layout' }).getByRole('button', { name: 'Garden windows' }).click()
  await expect(page.getByText('Layout changed to Garden windows. All changes saved.')).toBeVisible()
  await expect(page.getByRole('img', { name: /^Preview: garden windows, square, cream background$/ })).toBeVisible()
  await expect(page.getByLabel('Third label', { exact: true })).toHaveCount(0)
  await app.close()
})

test('seamless carousels: one wide design with its cuts, a note where a photo crosses one, and one file per slide', async () => {
  const { app } = await launchApp(profile)
  const page = await app.firstWindow()
  await ensureConnected(page)
  await nav(page, 'Favorites')
  const seamless = page.getByRole('region', { name: 'Seamless carousels', exact: true })
  await expect(seamless.getByRole('button')).toHaveCount(2)
  const pick = page.getByRole('button', { name: /^Select: / })
  for (const i of [0, 1, 2]) await pick.nth(i).click()
  // A print size chosen in the picker falls back to square: seamless carousels are made for sharing.
  await page.getByLabel('Size for the new project').selectOption('print-8x10')
  await seamless.getByRole('button', { name: /^Across the seam/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Across the seam' })).toBeVisible()
  await expect(page.getByText('Across the seam · 3 photos · 1080 × 1080 · 2 slides')).toBeVisible()
  await expect(page.getByRole('img', { name: /^Preview: across the seam, 2 square slides, cream background$/ })).toBeVisible()
  await expect(page.getByText('Photo 2 runs across the edge between slides 1 and 2.', { exact: false })).toBeVisible()

  // Only the slide shapes are offered.
  const shapes = page.getByRole('group', { name: 'Shape of each slide' })
  await expect(shapes.getByRole('radio')).toHaveCount(2)
  await expect(page.getByRole('group', { name: 'Print size (300 pixels per inch)' })).toHaveCount(0)
  await shapes.getByLabel('Portrait (1080 × 1350)').check()
  await expect(page.getByText('Size changed. All changes saved.')).toBeVisible()

  // Export: one numbered file per slide, each one slide wide.
  const destination = tempFolder('seamless-export')
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
  }, destination)
  const panel = page.getByRole('region', { name: 'Export' })
  await panel.getByRole('button', { name: 'Export…' }).click()
  await expect(panel).toContainText('Exported 2 files', { timeout: 30_000 })
  const [folder] = readdirSync(destination)
  expect(readdirSync(join(destination, folder!)).sort()).toEqual(['Across the seam 01.jpg', 'Across the seam 02.jpg'])
  await app.close()
})

test('swipe preview: slides side by side, then one at a time; a mat for carousels; the whole design as an extra file', async () => {
  const { app } = await launchApp(profile)
  const page = await app.firstWindow()
  await ensureConnected(page)
  await nav(page, 'Favorites')
  const pick = page.getByRole('button', { name: /^Select: / })
  for (const i of [0, 1, 2, 3, 4]) await pick.nth(i).click()
  await page.getByRole('region', { name: 'Playful seamless carousels' }).getByRole('button', { name: /^Scattered postcards/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Scattered postcards' })).toBeVisible()

  // Side by side: three slides, cut exactly as they'll be exported.
  await page.getByRole('button', { name: 'Preview the swipe' }).click()
  const swipe = page.getByRole('region', { name: 'Swipe preview' })
  await expect(swipe.getByRole('img', { name: /^Slide \d of 3$/ })).toHaveCount(3)
  // One at a time: the buttons and the arrow keys move between slides.
  await swipe.getByLabel('One at a time').check()
  await expect(swipe.getByText('Slide 1 of 3', { exact: true })).toBeVisible()
  await expect(swipe.getByRole('button', { name: '← Previous' })).toBeDisabled()
  await swipe.getByRole('button', { name: 'Next →' }).click()
  await expect(swipe.getByText('Slide 2 of 3', { exact: true })).toBeVisible()
  await swipe.getByLabel(/^Slide 2 of 3\. Use the arrow keys/).press('ArrowRight')
  await expect(swipe.getByText('Slide 3 of 3', { exact: true })).toBeVisible()
  await expect(swipe.getByRole('button', { name: 'Next →' })).toBeDisabled()

  // Export with the whole design too: three slides and one wide file.
  const destination = tempFolder('whole-export')
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
  }, destination)
  const panel = page.getByRole('region', { name: 'Export' })
  await panel.getByLabel('Also save the whole design as one wide file').check()
  await panel.getByRole('button', { name: 'Export…' }).click()
  await expect(panel).toContainText('Exported 4 files', { timeout: 30_000 })
  const [folder] = readdirSync(destination)
  expect(readdirSync(join(destination, folder!)).sort()).toEqual([
    'Scattered postcards 01.jpg',
    'Scattered postcards 02.jpg',
    'Scattered postcards 03.jpg',
    'Scattered postcards whole design.jpg',
  ])

  // A standard carousel offers a mat instead of spacing, and has no whole design to add.
  await page.getByRole('region', { name: 'Layout' }).getByRole('button', { name: 'Carousel', exact: true }).click()
  await expect(page.getByText('Layout changed to Carousel. All changes saved.')).toBeVisible()
  await page.getByRole('slider', { name: 'Mat' }).fill('80')
  await expect(page.getByText('Mat changed. All changes saved.')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Spacing' })).toHaveCount(0)
  await expect(panel.getByLabel('Also save the whole design as one wide file')).toHaveCount(0)
  await app.close()
})

test('Customize: drag, resize, nudge, flip, lock, hide and show, layer order and an empty place, all kept after a restart', async () => {
  let { app } = await launchApp(profile)
  let page = await app.firstWindow()
  await nav(page, 'Favorites')
  const pick = page.getByRole('button', { name: /^Select: / })
  for (const i of [0, 1, 2, 3]) await pick.nth(i).click()
  await page.getByRole('region', { name: 'Four photos' }).getByRole('button', { name: /^Classic grid/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Classic grid' })).toBeVisible()
  const saved = (text: string) => expect(page.getByText(`${text}. All changes saved.`)).toBeVisible()

  // Exact size, typed.
  await expect(page.getByRole('heading', { name: 'Arrange photo 1' })).toBeVisible()
  await page.getByLabel('Width', { exact: true }).fill('300')
  await saved('Photo 1 resized')

  // Drag photo 2 on the preview: pressing it selects it, dragging moves it.
  const canvas = page.locator('.studio__canvas').first()
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.25)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3, { steps: 5 })
  await page.mouse.up()
  await saved('Photo 2 moved')
  await expect(page.getByRole('heading', { name: 'Arrange photo 2' })).toBeVisible()
  const left = page.getByLabel('Left', { exact: true })
  const before = Number(await left.inputValue())

  // The arrow keys nudge it, from the Arrange controls.
  await page.getByRole('region', { name: 'Arrange photo 2' }).focus()
  await page.keyboard.press('Shift+ArrowRight')
  await saved('Photo 2 nudged')
  await expect(left).toHaveValue(String(before + 10))

  // Flip, layer order, and lock: a locked photo's place can't be typed or nudged.
  await page.getByLabel('Flip left to right').check()
  await saved('Photo 2 flipped')
  await page.getByRole('button', { name: 'Bring forward' }).click()
  await saved('Photo 2 brought forward')
  await page.getByLabel('Lock in place').check()
  await expect(left).toBeDisabled()

  // Hide, then find it in the list of hidden photos and show it again.
  await page.getByRole('button', { name: 'Hide' }).click()
  const hidden = page.getByRole('region', { name: 'Hidden photos (1)' })
  await expect(hidden).toBeVisible()
  await hidden.getByRole('button', { name: 'Show photo 2' }).click()
  await saved('Photo 2 shown again')
  await expect(page.getByRole('region', { name: /^Hidden photos/ })).toHaveCount(0)

  // Take photo 3 out: its place stays, empty, and export says so.
  await page.getByRole('button', { name: 'Adjust photo 3' }).click()
  await page.getByRole('button', { name: 'Take out of its place' }).click()
  await saved('Photo 3 taken out; its place is empty')
  await expect(page.getByRole('button', { name: 'Adjust photo 3, empty place' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Export' })).toContainText('1 empty place shows the background')
  await expect(page.getByRole('button', { name: 'Fill with a photo…' })).toBeVisible()
  await app.close()

  ;({ app } = await launchApp(profile))
  page = await app.firstWindow()
  await nav(page, 'Memory Studio')
  await page.getByRole('button', { name: /Classic grid/ }).first().click()
  await expect(page.getByRole('button', { name: 'Adjust photo 3, empty place' })).toBeVisible()
  await expect(page.getByLabel('Width', { exact: true })).toHaveValue('300')
  await page.getByRole('button', { name: 'Adjust photo 2' }).click()
  await expect(page.getByRole('heading', { name: 'Arrange photo 2 (locked)' })).toBeVisible()
  await expect(page.getByLabel('Flip left to right')).toBeChecked()
  await expect(page.getByLabel('Left', { exact: true })).toHaveValue(String(before + 10))
  await app.close()
})

test('captions wrap and keep the line breaks typed, the same after a restart', async () => {
  let { app } = await launchApp(profile)
  let page = await app.firstWindow()
  await nav(page, 'Favorites')
  const pick = page.getByRole('button', { name: /^Select: / })
  await pick.nth(2).click()
  await pick.nth(3).click()
  await page.getByRole('region', { name: 'Playful pairs' }).getByRole('button', { name: /^Love letter/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Love letter' })).toBeVisible()
  // The default note has a line break; the preview's description reads it as a pause.
  const note = page.getByLabel('Note', { exact: true })
  await expect(note).toHaveValue('Same brunch\nDifferent adventure')
  await expect(page.getByRole('img', { name: /caption “Same brunch, Different adventure”$/ })).toBeVisible()
  // Return adds a line break in the text box (it doesn't submit anything).
  await note.fill('')
  await note.pressSequentially('Lisbon')
  await note.press('Enter')
  await note.pressSequentially('the long way home')
  // Close as soon as the preview shows the last letter, well inside the 300 ms that groups typing into one undo step:
  // every change is saved as it happens, so nothing typed is lost by quitting quickly (a failure seen on CI).
  await expect(page.getByRole('img', { name: /caption “Lisbon, the long way home”$/ })).toBeVisible()
  await app.close()

  ;({ app } = await launchApp(profile))
  page = await app.firstWindow()
  await nav(page, 'Memory Studio')
  await page.getByRole('button', { name: /Love letter/ }).first().click()
  await expect(page.getByLabel('Note', { exact: true })).toHaveValue('Lisbon\nthe long way home')
  await app.close()
})

test('picker filters: by photo count, by style and by what fits the selection; the chosen size is the new project’s', async () => {
  const { app } = await launchApp(profile)
  const page = await app.firstWindow()
  await nav(page, 'Favorites')
  const groups = page.locator('.studio__templates').getByRole('region')
  await expect(groups).toHaveCount(7)

  // Style: playful shows only the playful pairs, quartets and seamless carousels.
  await page.getByRole('group', { name: 'Style' }).getByLabel('Playful').check()
  await expect(groups).toHaveCount(3)
  await expect(page.getByRole('region', { name: 'Playful pairs' })).toBeVisible()
  // Playful and four photos: just the playful quartets.
  await page.getByRole('group', { name: 'Show' }).getByLabel('Four photos').check()
  await expect(groups).toHaveCount(1)
  await expect(page.getByRole('region', { name: 'Playful quartets' }).getByRole('button')).toHaveCount(10)
  // Playful carousels: the playful seamless ones.
  await page.getByRole('group', { name: 'Show' }).getByLabel('Carousel').check()
  await expect(groups).toHaveCount(1)
  await expect(page.getByRole('region', { name: 'Playful seamless carousels' }).getByRole('button')).toHaveCount(2)

  // Everyday layouts that fit a selection of two photos: the two-photo layouts and the carousel, all enabled.
  await page.getByRole('group', { name: 'Style' }).getByLabel('Any style').check()
  await page.getByRole('group', { name: 'Show' }).getByLabel('Fit my selection').check()
  await expect(page.getByText('No layouts match these filters and your selection.')).toBeVisible() // nothing selected yet
  const pick = page.getByRole('button', { name: /^Select: / })
  await pick.nth(0).click()
  await pick.nth(1).click()
  await expect(page.getByRole('region', { name: 'Four photos' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Two photos' }).getByRole('button')).toHaveCount(8)
  await expect(page.locator('.studio__templates').getByRole('button', { disabled: true })).toHaveCount(0)

  // The size chosen here is the size the new project starts at.
  await page.getByLabel('Size for the new project').selectOption('portrait')
  await page.getByRole('region', { name: 'Two photos' }).getByRole('button', { name: /^Stacked/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Stacked' })).toBeVisible()
  await expect(page.getByLabel('Portrait (1080 × 1350)')).toBeChecked()
  await app.close()
})
