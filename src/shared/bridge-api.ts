/**
 * The TypeScript description of `window.nearmora`, the only API the UI can call.
 * The preload must implement it exactly, and the UI gets autocomplete and type checking from it.
 */

import type { CommandInput, CommandOutput, IpcResult, MainEvent } from './ipc-contract'

/**
 * The complete API the renderer can see, exposed as `window.nearmora`.
 * Adding a capability means adding a named method here, never a generic
 * `invoke(channel, ...)` escape hatch.
 */
export interface NearmoraApi {
  getAppInfo(): Promise<IpcResult<CommandOutput<'app:getInfo'>>>
  /** Opens the macOS folder picker; the chosen folder is added and scanned. */
  addSource(): Promise<IpcResult<CommandOutput<'sources:add'>>>
  listSources(): Promise<IpcResult<CommandOutput<'sources:list'>>>
  rescanSource(input: CommandInput<'sources:rescan'>): Promise<IpcResult<CommandOutput<'sources:rescan'>>>
  cancelScan(input: CommandInput<'scan:cancel'>): Promise<IpcResult<CommandOutput<'scan:cancel'>>>
  queryLibrary(input: CommandInput<'library:query'>): Promise<IpcResult<CommandOutput<'library:query'>>>
  /** Subscribes to events from main. Returns a function that unsubscribes. */
  onEvent(listener: (event: MainEvent) => void): () => void
}
