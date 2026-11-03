/**
 * Builds the third-party licence notices the app shows in Settings (run after `electron-vite build`, as part of
 * `npm run build`). It lists every package the app ships: those bundled into its code (recorded by the build), those
 * shipped as they are (the production dependencies), and Electron, each with its licence text. The build fails if any
 * shipped package has no licence text, so a new dependency can't slip into a release without its notice.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PARTS = ['main', 'preload', 'renderer']

/** Files that hold a package's licence text, in order of preference. */
const LICENCE_FILE = /^(licen[cs]e|copying|ofl)(\.(md|txt))?$/i

/**
 * A package whose licence text isn't in a licence file. libvips (in sharp's prebuilt binaries) lists its components'
 * licences in its README; that section is its notice, with where the source of the LGPL components can be found.
 */
const FROM_README = { '@img/sharp-libvips-darwin-arm64': '## Licensing' }
const LGPL_SOURCE =
  '\n\nThe LGPL-licensed libraries above are linked dynamically: they are separate files inside Nearmora.app ' +
  '(Contents/Resources/app.asar.unpacked/node_modules/@img), which can be replaced. Their source code is available ' +
  'from https://github.com/lovell/sharp-libvips and from each library’s own project.'

/** The licence text of one installed package, or null if it has none that can be found. */
export function licenceText(dir, name) {
  const heading = FROM_README[name]
  if (heading) {
    const readme = readFileSync(join(dir, 'README.md'), 'utf8')
    const start = readme.indexOf(heading)
    return start < 0 ? null : readme.slice(start).trim() + LGPL_SOURCE
  }
  const file = readdirSync(dir).find((f) => LICENCE_FILE.test(f))
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null
}

/**
 * One notice per package, sorted by name. `packages` maps each name to how it ships ("bundled", "shipped" or
 * "runtime"); `root` is the project folder. Returns the notices and the names that have no licence text.
 */
export function collectNotices(packages, root) {
  const notices = []
  const missing = []
  for (const [name, kind] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const dir = join(root, 'node_modules', name)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const text = licenceText(dir, name)
    if (!text) missing.push(name)
    notices.push({ name, version: manifest.version, license: manifest.license ?? 'see text', kind, text: text ?? '' })
  }
  return { notices, missing }
}

/** Every package the build ships, and how: bundled into its code, shipped as it is, or Electron itself. */
export function shippedPackages(root) {
  const packages = new Map()
  for (const part of PARTS) {
    const list = join(root, 'out', part, 'bundled-packages.json')
    if (!existsSync(list)) throw new Error(`No ${list}: run electron-vite build first`)
    for (const name of JSON.parse(readFileSync(list, 'utf8'))) packages.set(name, 'bundled')
  }
  // The production dependency tree is what electron-builder copies into the app.
  const tree = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: root, encoding: 'utf8' })
  for (const line of tree.split('\n').slice(1).filter(Boolean)) {
    const name = line.split('node_modules/').at(-1)
    if (!packages.has(name)) packages.set(name, 'shipped')
  }
  packages.set('electron', 'runtime')
  return packages
}

function main() {
  const root = process.cwd()
  const { notices, missing } = collectNotices(shippedPackages(root), root)
  if (missing.length > 0) {
    console.error(`No licence text found for: ${missing.join(', ')}. Add it before shipping (see scripts/notices.mjs).`)
    process.exit(1)
  }
  writeFileSync(join(root, 'out', 'main', 'third-party-notices.json'), `${JSON.stringify(notices, null, 2)}\n`)
  // The lists were only inputs; they don't need to ship.
  for (const part of PARTS) rmSync(join(root, 'out', part, 'bundled-packages.json'), { force: true })
  console.log(`Licence notices: ${notices.length} packages written to out/main/third-party-notices.json`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
