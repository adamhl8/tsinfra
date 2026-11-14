import { formatHostBlock, toDiffLimits } from "#report/format/format.ts"
import type {
  Detail,
  HostBlock,
  HostBlockEntry,
  PieceLevels,
  StepCommand,
  StepOption,
} from "#report/host-block/host-block.ts"
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

/** Reports whether a piece shows at `verbosity`: from its `from`, up to its `until` when it has one. */
const isShownAt = ({ from, until }: PieceLevels, verbosity: Verbosity): boolean =>
  verbosity >= from && (until === undefined || verbosity <= until)

/** Returns `option` with each value in it, its own and its entries', only when the value shows at `verbosity`. */
const keepShownOptionValues = (option: StepOption, verbosity: Verbosity): StepOption => {
  const { name, value } = option
  const entries = option.entries.map((entry) => keepShownOptionValues(entry, verbosity))
  return { name, ...(value && isShownAt(value, verbosity) && { value }), entries }
}

/** Returns `command` with its phase and what it printed only when each shows at `verbosity`. */
const keepShownCommandPieces = (command: StepCommand, verbosity: Verbosity): StepCommand => {
  const { cmd, label, phase, output } = command
  return {
    cmd,
    ...(label !== undefined && { label }),
    ...(phase && isShownAt(phase, verbosity) && { phase }),
    ...(output && isShownAt(output, verbosity) && { output }),
  }
}

/**
 * Returns `detail` with only the pieces inside it that show at `verbosity`: an option's values, and a command's phase
 * and what it printed.
 */
const keepShownInDetail = (detail: Detail, verbosity: Verbosity): Detail => {
  if (detail.kind === "options") {
    const options = detail.options.map((option) => keepShownOptionValues(option, verbosity))
    return { ...detail, options }
  }

  if (detail.kind === "commands") {
    const commands = detail.commands.map((command) => keepShownCommandPieces(command, verbosity))
    return { ...detail, commands }
  }

  return detail
}

/** Keeps the entries that show at `verbosity`, each with only the note parts and details that show. */
const keepShown = (hostBlockEntries: HostBlockEntry[], verbosity: Verbosity): HostBlockEntry[] =>
  hostBlockEntries.flatMap((hostBlockEntry) => {
    const note = hostBlockEntry.note.filter((notePart) => isShownAt(notePart, verbosity))
    const shownDetails = hostBlockEntry.details.filter((detail) => isShownAt(detail, verbosity))
    const details = shownDetails.map((detail) => keepShownInDetail(detail, verbosity))
    // Keep an entry when anything inside it shows, like a warning on a step that was already right, so it can't be missed.
    const isShown = isShownAt(hostBlockEntry, verbosity) || note.length > 0 || details.length > 0
    return isShown ? [{ ...hostBlockEntry, note, details }] : []
  })

/**
 * Renders a host's block at the level `reportOptions` asks for: its name, then each entry that shows, with only the
 * pieces that show. A host with no steps still gets a block at every level, so it's clear the host ran.
 */
export const renderHostBlock = (hostBlock: HostBlock, reportOptions: ReportOptions): string | undefined => {
  const { verbosity } = reportOptions
  // Give the diff limits instead of a level, because computing a full diff only to drop it would be slow.
  const diffLimits = toDiffLimits(verbosity)
  if (hostBlock.kind === "noSteps") return formatHostBlock(hostBlock, diffLimits)

  // Filter before formatting, so nothing hidden is formatted or measured for a column.
  const entries = keepShown(hostBlock.entries, verbosity)
  // Give a host whose steps are all hidden no block, because its line in the summary already says how it went.
  if (entries.length === 0) return

  return formatHostBlock({ ...hostBlock, entries }, diffLimits)
}
