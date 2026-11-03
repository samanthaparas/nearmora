/**
 * Beta-hardening checks in the built app (R6): the quit prompt for unsaved picks, the whole core workflow with
 * networking blocked and every request and socket inspected (AC9), automated accessibility checks on every screen,
 * reflow at 200% zoom, and reduced motion (AC10). Automated checks don't replace a real VoiceOver pass.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { generateBurstFolder } from '../tests/support/generate-photos'
import { launchApp, tempFolder } from './launch'

// axe-core is injected through the test connection, which (unlike a page script) isn't subject to the app's CSP.
const AXE_SOURCE = readFileSync(join(process.cwd(), 'node_modules/axe-core/axe.min.js'), 'utf8')
async function accessibilityViolations(page: Page): Promise<Array<{ id: string; help: string; nodes: number }>> {
  return page.evaluate(async (source) => {
    const global = window as unknown as { axe?: { run: (context: Document, options: object) => Promise<{ violations: Array<{ id: string; help: string; nodes: unknown[] }> }> } }
    if (!global.axe) (0, eval)(source)
    const result = await global.axe!.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
    return result.violations.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.length }))
  }, AXE_SOURCE)
}

const lsof = (args: string[]): string => {
  try {
    return execFileSync('lsof', args, { encoding: 'utf8' })
  } catch {
    return '' // lsof exits 1 when it finds nothing
  }
}

/**
 * Network sockets held by any of the app's processes, apart from the two loopback ports Playwright itself uses to
 * drive the app (Node's inspector and Chromium's debugging port). Those are exactly the loopback ports this test
 * process is connected to; packaged builds have both disabled by fuses.
 */
async function unexpectedSockets(app: ElectronApplication): Promise<{ unexpected: string[]; harnessPorts: number[] }> {
  const pids = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().map((m) => m.pid))
  const harnessPorts = [...lsof(['-nP', '-a', '-i', '-p', String(process.pid)]).matchAll(/->127\.0\.0\.1:(\d+)/g)].map((m) => Number(m[1]))
  const unexpected = lsof(['-nP', '-a', '-i', '-p', pids.join(',')])
    .split('\n')
    .slice(1)
    .filter((line) => line.trim())
    .filter((line) => {
      const name = line.trim().split(/\s+/).slice(8).join(' ') // e.g. "127.0.0.1:55795->127.0.0.1:55796 (ESTABLISHED)"
      const local = /^127\.0\.0\.1:(\d+)/.exec(name)
      const remoteOk = !name.includes('->') || /->127\.0\.0\.1:\d+/.test(name)
      return !(local && harnessPorts.includes(Number(local[1])) && remoteOk)
    })
  return { unexpected, harnessPorts }
}

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).click()

// Opens a project from Memory Studio's list. The sidebar keeps an open project open, so go back to the list first.
async function openProject(page: Page, name: RegExp) {
  await nav(page, 'Memory Studio')
  const back = page.getByRole('button', { name: '← All projects' })
  if ((await back.count()) > 0) await back.click()
  await page.locator('.moments__card', { hasText: name }).first().click()
}

async function pickFolderNextTime(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
  }, path)
}

// A profile with a scanned burst, saved favorites and an Equal split collage, so every screen has content.
async function seededProfile(extraArgs: string[] = []): Promise<{ app: ElectronApplication; page: Page; profileDir: string }> {
  const { root } = await generateBurstFolder(join(tempFolder('photos'), 'Burst'), 3)
  const { app, profileDir } = await launchApp(tempFolder('profile'), extraArgs)
  const page = await app.firstWindow()
  await pickFolderNextTime(app, root)
  await page.getByRole('button', { name: 'Add folder' }).click()
  await expect(page.locator('p', { hasText: 'Burst · 4 photos' })).toBeVisible({ timeout: 20_000 })
  await nav(page, 'Best Moments')
  await page.locator('.moments__card').first().click()
  await page.getByRole('button', { name: 'Favorite all' }).click()
  await page.getByRole('button', { name: 'Save choices' }).click()
  await expect(page.getByText('Saved: 3 favorites.')).toBeVisible()
  await nav(page, 'Favorites')
  const pick = page.getByRole('button', { name: /^Select: / })
  await pick.nth(0).click()
  await pick.nth(1).click()
  await page.getByRole('button', { name: /Equal split/ }).click()
  await expect(page.getByRole('region', { name: 'Export' })).toBeVisible()
  return { app, page, profileDir }
}

test('quitting with unsaved picks asks first: "Keep reviewing" stays, "Quit without saving" closes', async () => {
  const { app, page } = await seededProfile()
  await nav(page, 'Best Moments')
  await page.locator('.moments__card').first().click()
  await page.getByRole('button', { name: '★ Favorite' }).first().click() // now unsaved
  await expect(page.getByText('not saved yet', { exact: false })).toBeVisible()

  const closeWindowAnswering = (choice: number) =>
    app.evaluate(async ({ BrowserWindow, dialog }, answer) => {
      let asked = 0
      dialog.showMessageBoxSync = () => {
        asked++
        return answer
      }
      BrowserWindow.getAllWindows()[0]?.close()
      await new Promise((resolve) => setTimeout(resolve, 500))
      return { asked, windows: BrowserWindow.getAllWindows().length }
    }, choice)

  expect(await closeWindowAnswering(0)).toEqual({ asked: 1, windows: 1 }) // Keep reviewing
  await expect(page.getByText('not saved yet', { exact: false })).toBeVisible()
  expect(await closeWindowAnswering(1)).toEqual({ asked: 1, windows: 0 }) // Quit without saving
  await app.close()
})

test('the whole core workflow works with networking blocked, makes no network requests and opens no sockets (AC9)', async () => {
  // Chromium flag: every host name fails to resolve, so nothing could reach the network even if it tried.
  const { app, page } = await seededProfile(['--host-resolver-rules=MAP * ~NOTFOUND'])
  await app.evaluate(({ session }) => {
    const seen: string[] = []
    ;(globalThis as Record<string, unknown>)['__nearmoraRequests'] = seen
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      seen.push(details.url)
      callback({})
    })
  })

  // Exercise every area again with the recorder on: Library, Best Moments, Studio and export.
  await nav(page, 'Library')
  await expect(page.getByRole('list', { name: 'Photos, 4 in total' })).toBeVisible()
  await nav(page, 'Best Moments')
  await page.locator('.moments__card').first().click()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('button', { name: '← All sets' }).click()
  await nav(page, 'Memory Studio')
  await page.getByRole('button', { name: /Equal split/ }).first().click()
  const destination = tempFolder('exports')
  await pickFolderNextTime(app, destination)
  await page.getByRole('region', { name: 'Export' }).getByRole('button', { name: 'Export…' }).click()
  await expect(page.getByRole('region', { name: 'Export' })).toContainText('Exported 1 file', { timeout: 30_000 })

  // Positive control: a deliberate request from main must show up, proving the recorder sees network requests.
  await app.evaluate(async ({ net }) => {
    await net.fetch('https://control.nearmora.invalid/').catch(() => undefined)
  })
  const requests = await app.evaluate(() => (globalThis as Record<string, unknown>)['__nearmoraRequests'] as string[])
  expect(requests).toContain('https://control.nearmora.invalid/')
  // The recorder sometimes also reports the app's own in-process schemes (app:, nm-media:) and the file:// reads
  // behind them, depending on Chromium's cache. Those are local, so only other schemes count as network here.
  const local = ['app:', 'nm-media:', 'file:']
  expect(requests.filter((url) => url !== 'https://control.nearmora.invalid/' && !local.includes(new URL(url).protocol))).toEqual([])

  // Traffic inspection at the operating-system level: no process of the app holds a network socket.
  const { unexpected, harnessPorts } = await unexpectedSockets(app)
  expect(harnessPorts.length).toBeGreaterThan(0)
  expect(unexpected).toEqual([])
  await app.close()
})

test('every screen passes automated accessibility checks (WCAG 2.1 AA), at normal size and 200% zoom', async () => {
  test.setTimeout(240_000)
  const { app, page } = await seededProfile()

  // S7: give the screens added since R6 something to show. A photo marked "Don't need" for Clean up; the collage
  // customised (an added place, a hidden photo, a removed place) and saved as one of My templates; and a seamless
  // carousel, whose seam notes and swipe preview are checked too.
  await nav(page, 'Library')
  await page.getByRole('button', { name: 'Select photos' }).click()
  await page.getByRole('button', { name: /^Select:/ }).first().click()
  await page.getByRole('button', { name: 'Don’t need' }).click()
  await nav(page, 'Memory Studio')
  await page.getByRole('button', { name: /Equal split/ }).first().click()
  await page.getByRole('button', { name: 'Add a place' }).click()
  await page.getByRole('button', { name: 'Adjust photo 2' }).click()
  await page.getByRole('button', { name: 'Hide' }).click()
  await page.getByRole('button', { name: 'Adjust photo 3, empty place' }).click()
  await page.getByRole('button', { name: 'Remove this place' }).click()
  await expect(page.getByRole('region', { name: 'Removed places (1)' })).toBeVisible()
  await page.getByRole('button', { name: 'Save as my template…' }).click()
  await page.getByLabel('Template name').fill('Checked pair')
  await page.getByRole('button', { name: 'Save template' }).click()
  await nav(page, 'Favorites')
  const pick = page.getByRole('button', { name: /^Select: / })
  for (const i of [0, 1, 2]) await pick.nth(i).click()
  await page.getByRole('region', { name: 'Seamless carousels', exact: true }).getByRole('button', { name: /^Across the seam/ }).click()
  await expect(page.getByText('Where photos meet a slide edge')).toBeVisible()

  const screens: Array<[string, () => Promise<void>]> = [
    ['Library', () => nav(page, 'Library')],
    ['Best Moments', () => nav(page, 'Best Moments')],
    ['Set review', async () => {
      await nav(page, 'Best Moments')
      await page.locator('.moments__card').first().click()
    }],
    ['Favorites', () => nav(page, 'Favorites')],
    ['Memory Studio', () => nav(page, 'Memory Studio')],
    ['Project editor', async () => {
      await nav(page, 'Memory Studio')
      await page.getByRole('button', { name: /Equal split/ }).first().click()
    }],
    ['Customized editor: Arrange, hidden photos, removed places', async () => {
      await openProject(page, /Equal split/)
      await expect(page.getByRole('region', { name: 'Removed places (1)' })).toBeVisible()
    }],
    ['Seamless editor: guides, seam notes, swipe preview side by side', async () => {
      await openProject(page, /Across the seam/)
      await page.getByRole('button', { name: 'Preview the swipe' }).click()
    }],
    ['Swipe preview one at a time', () => page.getByRole('region', { name: 'Swipe preview' }).getByLabel('One at a time').check()],
    ['Favorites with My templates', () => nav(page, 'Favorites')],
    ['Clean up', () => nav(page, 'Clean up')],
    ['Sources', () => nav(page, 'Sources')],
    ['Settings', () => page.getByRole('button', { name: 'Settings', exact: true }).click()],
  ]

  const problems: string[] = []
  for (const zoom of [1, 2]) {
    await app.evaluate(({ BrowserWindow }, factor) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.setSize(1440, 900)
      window.webContents.setZoomFactor(factor)
    }, zoom)
    for (const [name, open] of screens) {
      await open()
      await page.waitForTimeout(300)
      for (const violation of await accessibilityViolations(page)) {
        problems.push(`${zoom * 100}% ${name}: ${violation.id} (${violation.nodes}) ${violation.help}`)
      }
      // Reflow (WCAG 1.4.10): at 200% nothing should need sideways scrolling.
      const overflow = await page.evaluate(() => {
        const main = document.getElementById('main')!
        return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: main.scrollWidth - main.clientWidth }
      })
      if (overflow.page > 1 || overflow.main > 1) problems.push(`${zoom * 100}% ${name}: sideways scrolling ${JSON.stringify(overflow)}`)
    }
  }
  expect(problems).toEqual([])
  await app.close()
})

test('reduced motion turns transitions and animations off', async () => {
  const { app, page } = await seededProfile()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const durations = await page.evaluate(() =>
    [...document.querySelectorAll('button')].slice(0, 20).map((el) => {
      const style = getComputedStyle(el)
      return Math.max(parseFloat(style.transitionDuration) || 0, parseFloat(style.animationDuration) || 0)
    }),
  )
  expect(Math.max(...durations)).toBeLessThanOrEqual(0.001)
  await app.close()
})

// S7: the swipe preview's slide from one slide to the next is the one moving part Studio added; it stops too.
test('reduced motion stops the swipe preview sliding between slides', async () => {
  const { app, page } = await seededProfile()
  await nav(page, 'Favorites')
  const pick = page.getByRole('button', { name: /^Select: / })
  for (const i of [0, 1, 2]) await pick.nth(i).click()
  await page.getByRole('button', { name: /^Carousel/ }).click()
  await page.getByRole('button', { name: 'Preview the swipe' }).click()
  await page.getByRole('region', { name: 'Swipe preview' }).getByLabel('One at a time').check()
  const track = page.locator('.studio__swipe-track')
  const duration = () => track.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration) || 0)
  expect(await duration()).toBeGreaterThan(0.1) // it does slide normally
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await duration()).toBeLessThanOrEqual(0.001)
  await app.close()
})

// S7: every Customize change can be made from the keyboard alone: focus moves to a control and keys do the rest.
test('Customize works from the keyboard alone: nudge, size, flip, hide and show, add and remove a place, save a template', async () => {
  const { app, page } = await seededProfile()
  const press = async (name: string | RegExp, key = 'Enter') => {
    await page.getByRole('button', { name }).focus()
    await page.keyboard.press(key)
  }
  const saved = (text: string) => expect(page.getByText(`${text}. All changes saved.`)).toBeVisible()
  const left = page.getByLabel('Left', { exact: true })
  const before = Number(await left.inputValue())
  await page.getByRole('region', { name: 'Arrange photo 1' }).focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Shift+ArrowRight')
  await saved('Photo 1 nudged')
  await expect(left).toHaveValue(String(before + 10))
  await page.getByLabel('Width', { exact: true }).focus()
  await page.keyboard.press('Meta+a')
  await page.keyboard.type('300')
  await saved('Photo 1 resized')
  await page.getByLabel('Flip left to right').focus()
  await page.keyboard.press('Space')
  await saved('Photo 1 flipped')
  await press('Hide', 'Space')
  await saved('Photo 1 hidden')
  await press('Show photo 1')
  await saved('Photo 1 shown again')
  await press('Add a place')
  await saved('Place 3 added')
  await press('Remove this place')
  await saved('Place 3 removed')
  await press('Restore place 3')
  await saved('Place 3 restored')
  await press('Save as my template…')
  await page.getByLabel('Template name').focus()
  await page.keyboard.press('Meta+a')
  await page.keyboard.type('Keyboard pair')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Saved “Keyboard pair” to My templates.', { exact: false })).toBeVisible()
  await app.close()
})

// S7 recovery: quitting straight after a drag keeps it; a project or template damaged on disk is named, never crashes.
test('quitting right after a drag keeps it, and a damaged project or template is explained instead of breaking Studio', async () => {
  const { app, page, profileDir } = await seededProfile()
  const left = page.getByLabel('Left', { exact: true })
  const before = await left.inputValue()
  const canvas = page.locator('.studio__canvas').first()
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.55, { steps: 3 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Save as my template…' }).click()
  await page.getByLabel('Template name').fill('Will be damaged')
  await page.getByRole('button', { name: 'Save template' }).click()
  await expect(page.getByText('Saved “Will be damaged”', { exact: false })).toBeVisible()
  await app.close() // straight after the drag: nothing waits for a pause in editing

  let { app: again } = await launchApp(profileDir)
  let page2 = await again.firstWindow()
  await nav(page2, 'Memory Studio')
  await page2.locator('.moments__card', { hasText: /Equal split/ }).first().click()
  await expect(page2.getByLabel('Left', { exact: true })).not.toHaveValue(before)
  await again.close()

  // Damage the stored settings of the project and the template, as a newer Nearmora or a disk fault might.
  const db = new Database(join(profileDir, 'catalog.sqlite'))
  db.prepare(`UPDATE project SET params_json = '{"v":99}'`).run()
  db.prepare(`UPDATE my_template SET params_json = '{"v":99}'`).run()
  db.close()
  ;({ app: again } = await launchApp(profileDir))
  page2 = await again.firstWindow()
  await nav(page2, 'Memory Studio')
  await page2.locator('.moments__card', { hasText: /Equal split/ }).first().click()
  await expect(page2.getByText('This project couldn’t be opened.')).toBeVisible()
  await nav(page2, 'Favorites') // the damaged template is left out, and the picker still works
  await expect(page2.getByRole('region', { name: 'My templates' })).toHaveCount(0)
  await expect(page2.getByRole('region', { name: 'Two photos' })).toBeVisible()
  await nav(page2, 'Library')
  await expect(page2.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
  await again.close()
})

// The fonts and open-source software the app ships are listed with their licences, as those licences ask.
test('Settings lists the licence of every font and package the app ships, each with its full text', async () => {
  const { app } = await launchApp(tempFolder('profile'))
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const list = page.getByRole('list', { name: 'Fonts and open-source software' })
  for (const name of [/^@fontsource\/caveat .* · OFL-1\.1$/, /^react \S+ · MIT$/, /^sharp \S+ · Apache-2\.0$/, /^@img\/sharp-libvips-darwin-arm64 .* · LGPL-3\.0-or-later$/, /^electron \S+ · MIT$/]) {
    await expect(list.getByText(name)).toBeVisible()
  }
  const sharpEntry = list.getByRole('listitem').filter({ has: page.getByText(/^sharp \S+ · Apache-2\.0$/) })
  await sharpEntry.getByText(/^sharp /).click()
  await expect(sharpEntry.getByText('Apache License', { exact: false })).toBeVisible()
  await app.close()
})

test('the checks themselves work: axe reports injected problems, and the socket check flags a real listener', async () => {
  const { app } = await launchApp(tempFolder('profile'))
  const page = await app.firstWindow()
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
  await page.evaluate(() => {
    const image = document.createElement('img') // no alt text
    image.src = 'app://nearmora/missing.png'
    const faint = document.createElement('p') // grey on white: far below 4.5:1
    faint.textContent = 'Hard to read'
    faint.style.cssText = 'color:#dddddd;background:#ffffff'
    document.getElementById('main')!.append(image, faint)
  })
  const ids = (await accessibilityViolations(page)).map((v) => v.id)
  expect(ids).toEqual(expect.arrayContaining(['image-alt', 'color-contrast']))

  await app.evaluate(async () => {
    type Net = { createServer: () => { listen: (port: number, host: string, done: () => void) => void } }
    const net = (process as unknown as { mainModule?: { require: (id: string) => Net } }).mainModule!.require('node:net')
    await new Promise<void>((resolve) => net.createServer().listen(0, '0.0.0.0', resolve))
  })
  const { unexpected } = await unexpectedSockets(app)
  expect(unexpected.some((line) => line.includes('LISTEN'))).toBe(true)
  await app.close()
})

test('Settings shows what is stored, and clearing caches rebuilds them without touching photos (AC9)', async () => {
  const { app, page } = await seededProfile()
  const settings = () => page.getByRole('button', { name: 'Settings', exact: true }).click()
  await settings()
  await expect(page.getByText('It isn’t encrypted', { exact: false })).toBeVisible()
  await expect(page.locator('dd', { hasText: /^4 files/ })).toBeVisible() // 4 distinct pictures, 4 thumbnails

  await page.getByRole('button', { name: 'Clear thumbnails' }).click()
  await expect(page.getByText('Cleared 4 thumbnails. 1 connected folder is being rescanned', { exact: false })).toBeVisible()
  // The rescan rebuilds them: revisit Settings until the count is back.
  await expect
    .poll(async () => {
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Library' }).click()
      await settings()
      return page.locator('dd', { hasText: /files,/ }).first().innerText()
    }, { timeout: 30_000 })
    .toMatch(/^4 files/)

  await page.getByRole('button', { name: 'Clear previews' }).click()
  await expect(page.getByText('previews. They’re made again', { exact: false })).toBeVisible()
  await app.close()
})
