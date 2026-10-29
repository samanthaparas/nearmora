/**
 * Smoke test for the packaged macOS app (`npm run test:packaged`, after `npm run package:mac`).
 * It checks the things only a real package can prove: the native libraries load from the
 * bundle, the security fuses are set, the app starts, and no source code was shipped.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses'
import asar from '@electron/asar'

const APP = 'release/mac-arm64/Nearmora.app'
const BINARY = join(APP, 'Contents/MacOS/Nearmora')
const RESOURCES = join(APP, 'Contents/Resources')
const MARKER = 'NEARMORA_SELF_TEST '

const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures.push(name)
}

// A macOS sandbox profile that denies every network operation (AC9: the app must work with networking off).
const NO_NETWORK = '(version 1)(allow default)(deny network*)'

// Runs the packaged binary and collects its output, killing it after `timeoutMs`. With `offline`, it runs inside
// the no-network sandbox.
function run(args, timeoutMs, { offline = false } = {}) {
  return new Promise((resolve) => {
    const child = offline
      ? spawn('sandbox-exec', ['-p', NO_NETWORK, BINARY, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn(BINARY, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (d) => (output += d))
    child.stderr.on('data', (d) => (output += d))
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ code: null, timedOut: true, output })
    }, timeoutMs)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, timedOut: false, output })
    })
  })
}

if (!existsSync(BINARY)) {
  console.error(`No packaged app at ${APP}. Run \`npm run package:mac\` first.`)
  process.exit(1)
}

// 1. Native libraries load and work inside the package.
const selfTest = await run(['--self-test'], 30_000)
const line = selfTest.output.split('\n').find((l) => l.startsWith(MARKER))
const report = line ? JSON.parse(line.slice(MARKER.length)) : undefined
check('self-test exits 0', selfTest.code === 0, `code ${selfTest.code}`)
check('SQLite works in the package', report?.sqlite?.ok === true, report?.sqlite?.version ?? report?.sqlite?.error)
check('sharp works in the package', report?.sharp?.ok === true, report?.sharp?.libvips ?? report?.sharp?.error)
check('media worker process makes a thumbnail in the package', report?.mediaWorker?.ok === true, report?.mediaWorker?.error)
check('catalog migrations apply in the package', report?.catalog?.ok === true, report?.catalog?.schemaVersion ? `schema v${report.catalog.schemaVersion}` : report?.catalog?.error)

// 2. Security fuses are set as electron-builder.yml asks.
const wire = await getCurrentFuseWire(BINARY)
const expected = {
  [FuseV1Options.RunAsNode]: FuseState.DISABLE,
  [FuseV1Options.EnableCookieEncryption]: FuseState.ENABLE,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: FuseState.DISABLE,
  [FuseV1Options.EnableNodeCliInspectArguments]: FuseState.DISABLE,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FuseState.ENABLE,
  [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.ENABLE,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: FuseState.DISABLE,
}
for (const [option, state] of Object.entries(expected)) {
  check(`fuse ${FuseV1Options[option]}`, wire[option] === state)
}

// 3. The disabled fuses really block what they should: Node mode and the inspector.
const asNode = await new Promise((resolve) => {
  const child = spawn(BINARY, ['-e', 'console.log("RAN_AS_NODE")'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  const timer = setTimeout(() => child.kill('SIGTERM'), 8_000)
  child.on('exit', () => {
    clearTimeout(timer)
    resolve(out)
  })
})
check('ELECTRON_RUN_AS_NODE is ignored', !asNode.includes('RAN_AS_NODE'))

// 4. The app starts normally and stays running (no crash on launch).
const launch = await run([], 6_000)
check('app launches and keeps running', launch.timedOut, launch.timedOut ? '' : `exited with ${launch.code}`)

// 4b. With all networking denied by the operating system, the self-test (database, image library, media worker
//     process, catalog) still passes (AC9). Control first: the same sandbox really does stop a process from opening
//     even a local socket. The full window can't be launched this way: Chromium refuses to start its own sandbox
//     inside another one, so the UI workflow's network check lives in the E2E suite instead.
const control = spawnSync('sandbox-exec', ['-p', NO_NETWORK, '/usr/bin/perl', '-MIO::Socket::INET', '-e', 'IO::Socket::INET->new(Listen=>1,LocalAddr=>"127.0.0.1:0") or exit 3'])
check('no-network sandbox blocks sockets (control)', control.status === 3, `exit ${control.status}`)
const offlineSelfTest = await run(['--self-test'], 30_000, { offline: true })
check('self-test passes with networking denied', offlineSelfTest.code === 0, `code ${offlineSelfTest.code}`)

// 5. Only compiled output was shipped: no TypeScript source, tests or docs.
const archive = join(RESOURCES, 'app.asar')
const files = asar.listPackage(archive, {})
// Third-party packages may ship their own .ts sources; we only check for ours.
const ownFiles = files.filter((f) => !f.startsWith('/node_modules/'))
const leaked = ownFiles.filter((f) => /^\/(src|tests|e2e|docs|scripts)(\/|$)/.test(f) || /\.tsx?$/.test(f))
check('no source, tests or docs in app.asar', leaked.length === 0, leaked.slice(0, 3).join(', '))
const bundledUiPackages = ['react', 'react-dom', '@fontsource-variable'].filter((p) => files.some((f) => f.startsWith(`/node_modules/${p}/`)))
check('UI-only packages not shipped (Vite already bundles them)', bundledUiPackages.length === 0, bundledUiPackages.join(', '))
check('native modules unpacked', existsSync(join(RESOURCES, 'app.asar.unpacked/node_modules/better-sqlite3')))
check('no stray files in Resources', !readdirSync(RESOURCES).some((f) => f === 'app' || f.endsWith('.ts')))

if (failures.length) {
  console.error(`\n${failures.length} packaged check(s) failed.`)
  process.exit(1)
}
console.log('\nAll packaged checks passed.')
