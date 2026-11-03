/**
 * Tells TypeScript what bundled asset imports give back. The build tools inline these files as data: URLs, which shared
 * code decodes itself, so the same import works in the main process, the UI and the tests (no file reads or fetches).
 */

declare module '*.woff?inline' {
  const dataUrl: string
  export default dataUrl
}
