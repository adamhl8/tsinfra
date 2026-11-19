import { formatHostBlock } from "#report/format.ts"
import { toDiffLimits } from "#report/format/details/diff/limits.ts"
import type {
  CommandGroup,
  Detail,
  HostBlock,
  HostBlockEntry,
  PieceLevels,
  StepCommand,
  StepOption,
} from "#report/host-block.ts"
import type { Verbosity } from "#report/verbosity.ts"

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

/** Returns `command` with its options' values and what it printed only when each shows at `verbosity`. */
const keepShownCommandPieces = (command: StepCommand, verbosity: Verbosity): StepCommand => {
  const { cmd, label, toolName, options, output } = command
  return {
    cmd,
    ...(label !== undefined && { label }),
    ...(toolName !== undefined && { toolName }),
    ...(options && { options: options.map((option) => keepShownOptionValues(option, verbosity)) }),
    ...(output && isShownAt(output, verbosity) && { output }),
  }
}

/** Returns `group` with its phase only when it shows at `verbosity`, and each command with only what shows. */
const keepShownGroupPieces = (group: CommandGroup, verbosity: Verbosity): CommandGroup => {
  const { phase } = group
  const commands = group.commands.map((command) => keepShownCommandPieces(command, verbosity))
  return { ...(phase && isShownAt(phase, verbosity) && { phase }), commands }
}

/**
 * Returns `detail` with only the pieces inside it that show at `verbosity`: an option's values, a command group's
 * phase, and what a command printed.
 */
const keepShownInDetail = (detail: Detail, verbosity: Verbosity): Detail => {
  if (detail.kind === "options") {
    const options = detail.options.map((option) => keepShownOptionValues(option, verbosity))
    return { ...detail, options }
  }

  if (detail.kind === "commands") {
    const groups = detail.groups.map((group) => keepShownGroupPieces(group, verbosity))
    return { ...detail, groups }
  }

  return detail
}

/** Keeps the entries that show at `verbosity`, each with only the note parts and details that show. */
const keepShownEntries = (hostBlockEntries: HostBlockEntry[], verbosity: Verbosity): HostBlockEntry[] =>
  hostBlockEntries.flatMap((hostBlockEntry) => {
    const note = hostBlockEntry.note.filter((notePart) => isShownAt(notePart, verbosity))
    const shownDetails = hostBlockEntry.details.filter((detail) => isShownAt(detail, verbosity))
    const details = shownDetails.map((detail) => keepShownInDetail(detail, verbosity))
    // Keep an entry when anything inside it shows, like a warning on a step that was already right, so it can't be missed.
    const isShown = isShownAt(hostBlockEntry, verbosity) || note.length > 0 || details.length > 0
    return isShown ? [{ ...hostBlockEntry, note, details }] : []
  })

/**
 * Returns a host's block with only what shows at `verbosity`: each entry that shows, with only the pieces that show. A
 * host with no steps keeps its block at every level, so it's clear the host ran.
 */
export const toShownHostBlock = (hostBlock: HostBlock, verbosity: Verbosity): HostBlock => {
  if (hostBlock.kind === "noSteps") return hostBlock

  const entries = keepShownEntries(hostBlock.entries, verbosity)
  return { ...hostBlock, entries }
}

/**
 * Renders a block from `toShownHostBlock` at the level `reportOptions` asks for. Filter first, so nothing hidden is
 * formatted or measured for a column.
 */
export const renderHostBlock = (hostBlock: HostBlock, reportOptions: ReportOptions): string | undefined => {
  const { verbosity } = reportOptions
  // Give the diff limits instead of a level, because computing a full diff only to drop it would be slow.
  const diffLimits = toDiffLimits(verbosity)
  if (hostBlock.kind === "noSteps") return formatHostBlock(hostBlock, diffLimits)

  // Give a host whose steps are all hidden no block, because its line in the summary already says how it went.
  if (hostBlock.entries.length === 0) return

  return formatHostBlock(hostBlock, diffLimits)
}
