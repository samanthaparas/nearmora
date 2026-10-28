import type { CommandName } from './ipc-contract'

// Kept separate from ipc-contract.ts so the sandboxed preload can import it
// without pulling in Zod.
export const channelFor = (command: CommandName): `nm:${CommandName}` => `nm:${command}`
