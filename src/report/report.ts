import { formatHostBlock } from "#report/format/format.ts"
import type { HostBlock } from "#report/host-block.ts"
import type { Verbosity } from "#report/verbosity.ts"

export { toHostBlock } from "#report/build/build.ts"
export type { EntryStatus, HostBlock } from "#report/host-block.ts"
export { ERROR_THEME, printTsinfraError } from "#report/errors.ts"
export { getExitCode } from "#report/exit-code.ts"
export { renderSummary } from "#report/summary.ts"
export { toVerbosity } from "#report/verbosity.ts"

export interface ReportOptions {
  /** How much of each host's block to show. Defaults to 0. */
  verbosity?: Verbosity
}

/**
 * Renders a host's block: its name, then an entry for each step that changed, ran, waits, or failed. From level 1,
 * every step gets an entry. A host with no steps still gets a block at every level, so it's clear the host ran.
 */
export const renderHostBlock = (hostBlock: HostBlock, reportOptions: ReportOptions = {}): string | undefined => {
  // Give a host whose steps are all hidden no block, because its line in the summary already says how it went.
  if (hostBlock.kind === "entries" && hostBlock.entries.length === 0) return

  return formatHostBlock(hostBlock, reportOptions)
}
