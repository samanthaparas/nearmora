/**
 * End-to-end test of Clean up (ADR-0019) in the real built app: mark photos "Don't need" in the Library, choose which
 * identical copy stays, move files to a stand-in Trash, and delete forever only through the native confirmation.
 * The photo folder and the Trash folder are the test's own; the macOS dialogs are the only things replaced.
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { generatePhotoFolder } from '../tests/support/generate-photos'
import { fingerprintFolder } from '../tests/support/originals-guard'
import { launchApp, tempFolder } from './launch'

// Replaces the folder picker (an OS dialog Playwright can't click) with one that "chooses" `path`.
async function pickFolderNextTime(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
  }, path)
}

// Replaces the native "Delete forever?" question with one that answers `response` (0 Cancel, 1 Delete forever) and
// remembers what it was asked, so the test can check the wording and that Cancel is the default.
async function answerDeleteForever(app: ElectronApplication, response: 0 | 1): Promise<void> {
  await app.evaluate(({ dialog }, answer) => {
    const asked: unknown[] = []
    ;(globalThis as { asked?: unknown[] }).asked = asked
    dialog.showMessageBox = ((...args: unknown[]) => {
      asked.push(args.at(-1))
      return Promise.resolve({ response: answer, checkboxChecked: false })
    })
  }, response)
}
const askedSoFar = (app: ElectronApplication) => app.evaluate(() => (globalThis as { asked?: unknown[] }).asked ?? [])

async function markUnneeded(page: Page, photo: RegExp) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Library' }).click()
  await page.getByRole('button', { name: 'Select photos' }).click()
  await page.getByRole('button', { name: photo }).click()
  await page.getByRole('button', { name: 'Don’t need' }).click()
}

test('photos marked "Don\'t need" and extra copies go to the Trash; deleting forever needs the native confirmation', async () => {
  const folder = await generatePhotoFolder(join(tempFolder('photos'), 'Summer'))
  const trashDir = tempFolder('trash')
  const before = fingerprintFolder(folder.root)
  const { app } = await launchApp(tempFolder('profile'), [], { NEARMORA_TEST_TRASH_DIR: trashDir })
  const page = await app.firstWindow()
  const nav = (name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).click()

  await pickFolderNextTime(app, folder.root)
  await page.getByRole('button', { name: 'Add folder' }).click()
  await expect(page.getByRole('list', { name: `Photos, ${folder.expected.distinctPhotos} in total` })).toBeVisible({ timeout: 20_000 })

  // Marking is only a note, and Undo takes it back.
  await markUnneeded(page, /^Select: Photo from .*2023/) // rotated.jpg, dated 2023
  await expect(page.getByText('Marked 1 photo “Don’t need”.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await markUnneeded(page, /^Select: Photo from .*2023/)
  expect(fingerprintFolder(folder.root)).toEqual(before)

  await nav('Clean up')
  await expect(page.getByRole('heading', { name: 'Photos you don’t need (1)' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Photos you don’t need' })).toContainText('rotated.jpg')
  await expect(page.getByRole('heading', { name: 'Identical copies (1)' })).toBeVisible()

  // Nothing is chosen for the person: the group is cleared only after they tick it, and they pick the copy that stays.
  await expect(page.getByRole('button', { name: 'Move 1 file to Trash' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Clear extra copies of dated-copy.jpg' }).check()
  await page.getByRole('radio', { name: 'dated.jpg in Summer' }).check()
  await expect(page.getByText('1 photo you don’t need and 1 extra copy: 2 files', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Move 2 files to Trash' }).click()
  await expect(page.getByText('Moved 2 files', { exact: false })).toBeVisible()

  expect(readdirSync(trashDir).map((name) => name.replace(/^\d+-/, '')).sort()).toEqual(['dated-copy.jpg', 'rotated.jpg'])
  const afterTrash = Object.fromEntries(Object.entries(before).filter(([path]) => path !== 'rotated.jpg' && path !== 'copies/dated-copy.jpg'))
  expect(fingerprintFolder(folder.root)).toEqual(afterTrash)
  await expect(page.getByRole('heading', { name: 'Photos you don’t need (0)' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Identical copies (0)' })).toBeVisible()

  // Delete forever: the native question comes first, with Cancel as the default. Cancelling deletes nothing.
  await markUnneeded(page, /^Select: Photo from .*2024/) // dated.jpg, its last copy now
  await nav('Clean up')
  await page.getByRole('radio', { name: /^Delete forever/ }).check()
  await answerDeleteForever(app, 0)
  await page.getByRole('button', { name: 'Delete 1 file forever…' }).click()
  await expect(page.getByText('Nothing was deleted.')).toBeVisible()
  expect(existsSync(join(folder.root, 'dated.jpg'))).toBe(true)
  expect(await askedSoFar(app)).toEqual([
    expect.objectContaining({ message: 'Delete 1 file forever?', buttons: ['Cancel', 'Delete forever'], defaultId: 0, cancelId: 0 }),
  ])

  await answerDeleteForever(app, 1)
  await page.getByRole('button', { name: 'Delete 1 file forever…' }).click()
  await expect(page.getByText('Deleted 1 file', { exact: false })).toBeVisible()
  expect(existsSync(join(folder.root, 'dated.jpg'))).toBe(false)
  expect(readdirSync(trashDir)).toHaveLength(2) // forever means it never went to the Trash
  // After a removal the choice goes back to the Trash, so "forever" is never left selected by accident.
  await expect(page.getByRole('radio', { name: /^Move to Trash/ })).toBeChecked()

  // The record lists all three, and the Library no longer shows the removed pictures.
  await page.getByText('Recently removed (3)').click()
  await expect(page.getByText(/dated\.jpg in Summer, .*deleted forever/)).toBeVisible()
  await nav('Library')
  await expect(page.getByRole('list', { name: `Photos, ${folder.expected.distinctPhotos - 2} in total` })).toBeVisible()

  await app.close()
  expect(fingerprintFolder(folder.root)).toEqual(Object.fromEntries(Object.entries(afterTrash).filter(([path]) => path !== 'dated.jpg')))
})
