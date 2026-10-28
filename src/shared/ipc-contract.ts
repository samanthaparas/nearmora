/**
 * The list of everything the UI is allowed to ask the main process to do, with the exact shape of each request and reply.
 * It's the single source of truth for the security boundary between the UI and the rest of the computer.
 */

import { z } from 'zod'

/**
 * Every command the renderer may send to the main process.
 *
 * TypeScript types vanish at runtime, so each command also carries Zod schemas.
 * Main validates input before running a handler, and validates output before
 * replying, so a bug in a handler can't leak extra fields to the renderer.
 *
 * Only the main process imports this file as a value. The renderer and preload
 * use `import type`, which keeps Zod out of their bundles.
 */
export const commands = {
  'app:getInfo': {
    input: z.undefined(),
    output: z.object({
      name: z.string(),
      version: z.string(),
    }),
  },
} as const

export type Commands = typeof commands
export type CommandName = keyof Commands
export type CommandInput<C extends CommandName> = z.input<Commands[C]['input']>
export type CommandOutput<C extends CommandName> = z.output<Commands[C]['output']>

/** Error codes are deliberately coarse: no messages, paths or stack traces cross the bridge. */
export type IpcErrorCode = 'UNTRUSTED_SENDER' | 'UNKNOWN_COMMAND' | 'INVALID_INPUT' | 'INTERNAL'

/** A discriminated union: check `ok` and TypeScript narrows to `data` or `error`. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: IpcErrorCode } }
