/**
 * The list of everything the UI is allowed to ask the main process to do, with the exact shape of each request and reply.
 * It's the single source of truth for the security boundary between the UI and the rest of the computer.
 */

import { z } from 'zod'

const id = z.uuid()
const count = z.number().int().nonnegative()

/** What a scan found, by outcome. Shown to explain why some files aren't in the Library (AC2). */
export const ScanCounts = z.object({
  found: count,
  indexed: count,
  unchanged: count,
  unsupported: count,
  corrupt: count,
  tooLarge: count,
  unreadable: count,
})
export type ScanCounts = z.infer<typeof ScanCounts>

// Sources are described by name and status; the UI never receives or sends a file path.
const SourceSummary = z.object({
  id,
  displayName: z.string(),
  status: z.enum(['active', 'disconnected', 'permission_denied', 'removed']),
  lastScanAt: z.number().int().nullable(),
  lastScan: ScanCounts.nullable(),
  /** How the last scan ended. 'paused' (including a scan interrupted by quitting) can be resumed. */
  lastScanState: z.enum(['done', 'paused', 'cancelled', 'failed']).nullable(),
  /** Distinct pictures available in this folder; identical copies count once. */
  pictureCount: count,
  /** Files that are byte-identical copies of a picture already counted. */
  duplicateCount: count,
  scanning: z.boolean(),
})
export type SourceSummary = z.infer<typeof SourceSummary>

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
  // Main opens the folder picker itself, so the UI never supplies a path (roadmap §6.5).
  'sources:add': {
    input: z.undefined(),
    output: z.discriminatedUnion('status', [
      z.object({ status: z.literal('added'), source: SourceSummary }),
      z.object({ status: z.literal('cancelled') }),
      z.object({ status: z.literal('refused'), reason: z.enum(['unavailable', 'overlap', 'app_data']) }),
    ]),
  },
  'sources:list': {
    input: z.undefined(),
    output: z.array(SourceSummary),
  },
  // Also resumes a paused scan: unchanged files are skipped, so it carries on where it stopped.
  'sources:rescan': {
    input: z.object({ sourceId: id }),
    output: z.object({ started: z.boolean() }),
  },
  // For a folder that went offline: checks it's the same folder before using it again.
  'sources:reconnect': {
    input: z.object({ sourceId: id }),
    output: z.object({ result: z.enum(['reconnected', 'unavailable', 'permission_denied', 'different_folder']) }),
  },
  'sources:removeImpact': {
    input: z.object({ sourceId: id }),
    output: z.object({ photoFiles: count, picturesOnlyHere: count, favoritesOnlyHere: count, albumsAffected: count }),
  },
  // Removes the folder from the catalog only. Files on disk are never touched.
  'sources:remove': {
    input: z.object({ sourceId: id }),
    output: z.object({ removed: z.boolean() }),
  },
  'scan:pause': {
    input: z.object({ sourceId: id }),
    output: z.object({ paused: z.boolean() }),
  },
  'scan:cancel': {
    input: z.object({ sourceId: id }),
    output: z.object({ cancelled: z.boolean() }),
  },
  'library:query': {
    input: z.object({
      limit: z.number().int().min(1).max(500),
      // Continue after this photo (keyset paging); omit for the first page.
      cursor: z.object({ capturedAt: z.number().int().nullable(), id }).nullable().optional(),
      filters: z
        .object({
          search: z.string().max(200).optional(),
          from: z.number().int().optional(),
          to: z.number().int().optional(),
          sourceId: id.optional(),
          favoritesOnly: z.boolean().optional(),
          momentId: id.optional(),
        })
        .optional(),
    }),
    output: z.object({
      items: z.array(
        z.object({
          id,
          width: z.number().int().nullable(),
          height: z.number().int().nullable(),
          capturedAt: z.number().int().nullable(),
          /** Only reachable through a disconnected folder: the cached thumbnail shows, the original can't be opened. */
          offline: z.boolean(),
        }),
      ),
      total: count,
      nextCursor: z.object({ capturedAt: z.number().int().nullable(), id }).nullable(),
    }),
  },
  'moments:list': {
    input: z.undefined(),
    output: z.array(
      z.object({
        id,
        // The person's title, or null to show the date-based one.
        title: z.string().nullable(),
        autoTitle: z.string(),
        startsAt: z.number().int(),
        endsAt: z.number().int(),
        photoCount: count,
        coverAssetId: id.nullable(),
      }),
    ),
  },
  'moments:update': {
    input: z.object({
      momentId: id,
      title: z.string().trim().min(1).max(120).nullable().optional(),
      coverAssetId: id.nullable().optional(),
    }),
    output: z.object({ updated: z.literal(true) }),
  },
} as const

export type Commands = typeof commands
export type CommandName = keyof Commands
export type CommandInput<C extends CommandName> = z.input<Commands[C]['input']>
export type CommandOutput<C extends CommandName> = z.output<Commands[C]['output']>

/** Error codes are deliberately coarse: no messages, paths or stack traces cross the bridge. */
export type IpcErrorCode = 'UNTRUSTED_SENDER' | 'UNKNOWN_COMMAND' | 'INVALID_INPUT' | 'INTERNAL'

/** Messages main pushes to the UI on one channel. Only scan progress for now. */
export type MainEvent = {
  type: 'scan'
  sourceId: string
  state: 'running' | 'done' | 'paused' | 'cancelled' | 'failed'
  counts: ScanCounts
}

/** A discriminated union: check `ok` and TypeScript narrows to `data` or `error`. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: IpcErrorCode } }
