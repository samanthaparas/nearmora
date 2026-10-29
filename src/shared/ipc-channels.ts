/**
 * Turns a command name into the internal IPC channel name.
 * Shared by the preload and the main process so the two can never disagree on a channel name.
 */

import type { CommandName } from './ipc-contract'

// Kept separate from ipc-contract.ts so the sandboxed preload can import it
// without pulling in Zod.
/** The one channel main uses to push events (such as scan progress) to the UI. */
export const EVENT_CHANNEL = 'nm:event'

export const channelFor = (command: CommandName): `nm:${CommandName}` => `nm:${command}`
