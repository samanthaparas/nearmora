import type { z } from 'zod'
import {
  commands,
  type CommandInput,
  type CommandName,
  type CommandOutput,
  type IpcErrorCode,
  type IpcResult,
} from '@shared/ipc-contract'

/**
 * A mapped type: for every command name C, a handler that takes that
 * command's input and returns its output. Forgetting a handler, or returning
 * the wrong shape, is a compile error.
 */
export type Handlers = {
  [C in CommandName]: (input: CommandInput<C>) => CommandOutput<C> | Promise<CommandOutput<C>>
}

export interface RouterOptions {
  handlers: Handlers
  isTrustedSender: (senderUrl: string | undefined) => boolean
  /** Receives the command name and error code only, never payloads. */
  logError?: (command: string, code: IpcErrorCode, cause?: unknown) => void
}

const isCommandName = (name: string): name is CommandName => Object.hasOwn(commands, name)

/**
 * Builds the function every IPC call goes through. It has no Electron
 * dependency, so the whole security path is unit-testable:
 * trusted sender → known command → valid input → handler → valid output.
 */
export function createRouter({ handlers, isTrustedSender, logError = () => {} }: RouterOptions) {
  const fail = (command: string, code: IpcErrorCode, cause?: unknown): IpcResult<never> => {
    logError(command, code, cause)
    return { ok: false, error: { code } }
  }

  return async function dispatch(
    command: string,
    senderUrl: string | undefined,
    payload: unknown,
  ): Promise<IpcResult<unknown>> {
    if (!isTrustedSender(senderUrl)) return fail(command, 'UNTRUSTED_SENDER')
    if (!isCommandName(command)) return fail(command, 'UNKNOWN_COMMAND')

    const spec = commands[command]
    const input = spec.input.safeParse(payload)
    if (!input.success) return fail(command, 'INVALID_INPUT')

    // Each command's handler and schemas line up by construction (see Handlers),
    // but TypeScript can't follow that through an index with a union key, so we
    // widen to a common signature here, in one place.
    const handler = handlers[command] as (input: unknown) => unknown
    const outputSchema: z.ZodType = spec.output

    let raw: unknown
    try {
      raw = await handler(input.data)
    } catch (error: unknown) {
      return fail(command, 'INTERNAL', error)
    }

    const output = outputSchema.safeParse(raw)
    if (!output.success) return fail(command, 'INTERNAL', output.error)
    return { ok: true, data: output.data }
  }
}
