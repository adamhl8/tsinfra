import { DEFAULT_DIFF_LIMITS, formatHostBlock } from "#report/format/format.ts"
import type { HostBlock, HostBlockEntry } from "#report/host-block/host-block.ts"
import type { Verbosity } from "#report/verbosity.ts"

export { toHostBlock } from "#report/host-block/host-block.ts"
export type { EntryStatus, HostBlock } from "#report/host-block/host-block.ts"
export { ERROR_THEME, printTsinfraError } from "#report/errors.ts"
export { getExitCode } from "#report/exit-code.ts"
export { renderSummary } from "#report/summary.ts"
export { toVerbosity } from "#report/verbosity.ts"

export interface ReportOptions {
  /** How much of each host's block to show. */
  verbosity: Verbosity
}

/** Keeps the entries that show at `verbosity`, each with only the options, note parts, and details that show. */
const keepShown = (hostBlockEntries: HostBlockEntry[], verbosity: Verbosity): HostBlockEntry[] =>
  hostBlockEntries.flatMap((hostBlockEntry) => {
    const options = hostBlockEntry.options.filter(({ from }) => verbosity >= from)
    const note = hostBlockEntry.note.filter(({ from }) => verbosity >= from)
    const details = hostBlockEntry.details.filter(({ from }) => verbosity >= from)
    // Keep an entry when anything inside it shows, like a warning on a step that was already right, so it can't be missed.
    const isShown = verbosity >= hostBlockEntry.from || options.length > 0 || note.length > 0 || details.length > 0
    return isShown ? [{ ...hostBlockEntry, options, note, details }] : []
  })

/**
 * Renders a host's block at the level `reportOptions` asks for: its name, then each entry that shows, with only the
 * pieces that show. A host with no steps still gets a block at every level, so it's clear the host ran.
 */
export const renderHostBlock = (hostBlock: HostBlock, reportOptions: ReportOptions): string | undefined => {
  const { verbosity } = reportOptions
  // Give the diff limits instead of a level, because computing a full diff only to drop it would be slow.
  const diffLimits = verbosity >= 1 ? undefined : DEFAULT_DIFF_LIMITS
  if (hostBlock.kind === "noSteps") return formatHostBlock(hostBlock, diffLimits)

  // Filter before formatting, so nothing hidden is formatted or measured for a column.
  const entries = keepShown(hostBlock.entries, verbosity)
  // Give a host whose steps are all hidden no block, because its line in the summary already says how it went.
  if (entries.length === 0) return

  return formatHostBlock({ ...hostBlock, entries }, diffLimits)
}
