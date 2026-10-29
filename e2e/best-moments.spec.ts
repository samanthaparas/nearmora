/**
 * End-to-end tests of Best Moments in the built app (AC3, AC4, AC5, AC13): review a set, choose favorites, save and
 * undo, the unsaved-changes dialog, Decide later, corrections, narrow-window tabs, and going offline mid-review.
 * Uses a generated burst of three near-identical photos plus one different photo taken a minute later.
 */

import { renameSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { generateBurstFolder } from '../tests/support/generate-photos'
import { fingerprintFolder } from '../tests/support/originals-guard'
import { launchApp, tempFolder } from './launch'

let root: string
let profile: string
let before: ReturnType<typeof fingerprintFolder>

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).click()

async function openFirstSet(page: Page): Promise<void> {
  await nav(page, 'Best Moments')
  await page.locator('.moments__card').first().click()
  await expect(page.getByRole('heading', { level: 2, name: /similar photos/ })).toBeVisible()
}

async function start(): Promise<{ app: ElectronApplication; page: Page }> {
  const { app } = await launchApp(profile)
  const page = await app.firstWindow()
  return { app, page }
}

test.beforeAll(async () => {
  root = (await generateBurstFolder(join(tempFolder('photos'), 'Burst'))).root
  before = fingerprintFolder(root)
  profile = tempFolder('profile')
  const { app, page } = await start()
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
  }, root)
  await page.getByRole('button', { name: 'Add folder' }).click()
  await expect(page.locator('p', { hasText: 'Burst · 4 photos' })).toBeVisible({ timeout: 20_000 })
  await app.close()
})

test.afterAll(() => {
  // AC1 still holds after everything below: no original was changed.
  expect(fingerprintFolder(root)).toEqual(before)
})

test('the burst becomes one set; choose two favorites, save, undo, save again', async () => {
  const { app, page } = await start()
  await nav(page, 'Best Moments')
  await expect(page.getByRole('heading', { level: 2, name: 'To review (1)' })).toBeVisible()
  await page.locator('.moments__card').first().click()
  await expect(page.getByRole('heading', { level: 2, name: '3 similar photos' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'All photos in this set' }).getByRole('button')).toHaveCount(3)

  const favorites = page.getByRole('button', { name: /Favorite$/ })
  await favorites.nth(0).click()
  await favorites.nth(1).click()
  await expect(page.getByRole('button', { name: '★ Favorite' })).toHaveCount(2)
  await expect(page.getByText('2 of 3 chosen · not saved yet')).toBeVisible()
  await page.getByRole('button', { name: 'Save choices' }).click()
  await expect(page.getByText('Saved: 2 favorites.')).toBeVisible()

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Undone.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '★ Favorite' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Favorite all' }).click()
  await page.getByRole('button', { name: 'Save choices' }).click()
  await expect(page.getByText('Saved: 3 favorites.')).toBeVisible()
  await app.close()
})

test('leaving with unsaved choices asks first: Escape continues, Discard leaves, and focus stays in the dialog', async () => {
  const { app, page } = await start()
  await openFirstSet(page)
  await page.getByRole('button', { name: '★ Favorite' }).first().click() // un-favorite: now unsaved

  await nav(page, 'Library')
  const dialog = page.getByRole('dialog', { name: 'Save your choices?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeFocused()
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab')
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 2, name: '3 similar photos' })).toBeVisible()

  await nav(page, 'Library')
  await dialog.getByRole('button', { name: 'Discard changes' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()

  // Nothing was saved by discarding: all three are still favorites.
  await openFirstSet(page)
  await expect(page.getByRole('button', { name: '★ Favorite' })).toHaveCount(2) // A and B panels; the third is in the strip
  await expect(page.getByText('3 of 3 chosen')).toBeVisible()
  await app.close()
})

test('Decide later keeps the set in the queue, marked as saved for later', async () => {
  const { app, page } = await start()
  await openFirstSet(page)
  await page.getByRole('button', { name: 'Decide later' }).click()
  await expect(page.getByText('Saved for later.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '← All sets' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'To review (1)' })).toBeVisible()
  await expect(page.getByText('Saved for later · 3 favorites')).toBeVisible()
  await app.close()
})

test('a narrow window shows the two photos as A/B tabs', async () => {
  const { app, page } = await start()
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    window.setMinimumSize(600, 600)
    window.setSize(800, 800)
  })
  await openFirstSet(page)
  const tabs = page.getByRole('tablist', { name: 'Photos being compared' })
  await expect(tabs).toBeVisible()
  await expect(page.getByRole('figure', { name: 'Photo A' })).toBeVisible()
  await expect(page.getByRole('figure', { name: 'Photo B' })).toBeHidden()
  await tabs.getByRole('tab', { name: 'Photo B' }).click()
  await expect(page.getByRole('figure', { name: 'Photo B' })).toBeVisible()
  await expect(page.getByRole('figure', { name: 'Photo A' })).toBeHidden()
  await app.close()
})

test('corrections: add a nearby photo, remove one, split the set apart, and the split survives a rescan', async () => {
  const { app, page } = await start()
  await openFirstSet(page)
  await page.getByRole('button', { name: 'Add a photo taken around the same time…' }).click()
  await page.getByRole('button', { name: /^Add to this set/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: '4 similar photos' })).toBeVisible()

  await page.getByRole('button', { name: 'Remove from set' }).first().click()
  await expect(page.getByRole('heading', { level: 2, name: '3 similar photos' })).toBeVisible()

  await page.getByRole('button', { name: 'These aren’t similar: split set apart…' }).click()
  await page.getByRole('button', { name: 'Split set apart', exact: true }).click()
  await expect(page.getByText('This set has been split up', { exact: false })).toBeVisible()

  // A rescan regroups everything; the split must stick.
  await nav(page, 'Sources')
  await page.getByRole('button', { name: 'Rescan' }).click()
  await expect(page.locator('p', { hasText: 'Burst · 4 photos' })).toBeVisible({ timeout: 20_000 })
  await nav(page, 'Best Moments')
  await expect(page.getByRole('heading', { level: 2, name: 'No similar photos yet.' })).toBeVisible()
  await app.close()
})

test('going offline mid-review loses nothing: choices still save, and the folder shows as disconnected', async () => {
  // Fresh profile, so there's an unsplit set to review.
  profile = tempFolder('profile-offline')
  const { app, page } = await start()
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
  }, root)
  await page.getByRole('button', { name: 'Add folder' }).click()
  await expect(page.locator('p', { hasText: 'Burst · 4 photos' })).toBeVisible({ timeout: 20_000 })

  await openFirstSet(page)
  await page.getByRole('button', { name: /Favorite$/ }).first().click()
  const parked = `${root}-unplugged`
  renameSync(root, parked) // the test's own folder disappears mid-review, standing in for an unplugged drive
  try {
    await page.getByRole('button', { name: 'Save choices' }).click()
    await expect(page.getByText('Saved: 1 favorite.')).toBeVisible()
    await nav(page, 'Library')
    await expect(page.getByText('Not connected.', { exact: false })).toBeVisible()
    await app.close()

    const again = await start()
    await openFirstSet(again.page)
    await expect(again.page.getByText('1 of 3 chosen')).toBeVisible()
    await again.app.close()
  } finally {
    renameSync(parked, root)
  }
})
