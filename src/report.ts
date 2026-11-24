import { formatHostBlock } from "#report/format.ts"
import { toDiffLimits } from "#report/format/details/diff/limits.ts"
import type {
  Detail,
  HostBlock,
  HostBlockEntry,
  PieceLevels,
  StepCommand,
  StepMessage,
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

/** Returns `piece` only when it shows at `verbosity`. */
const keepShown = <T extends PieceLevels>(piece: T | undefined, verbosity: Verbosity): T | undefined =>
  piece && isShownAt(piece, verbosity) ? piece : undefined

/** Returns `option` with each value in it, its own and its entries', only when the value shows at `verbosity`. */
const keepShownOptionValues = (option: StepOption, verbosity: Verbosity): StepOption => {
  const value = keepShown(option.value, verbosity)
  const entries = option.entries.map((entry) => keepShownOptionValues(entry, verbosity))
  return { ...option, value, entries }
}

/** Returns `command` with its options' values and what it printed only when each shows at `verbosity`. */
const keepShownCommandPieces = (command: StepCommand, verbosity: Verbosity): StepCommand => {
  const options = command.options.map((option) => keepShownOptionValues(option, verbosity))
  const output = keepShown(command.output, verbosity)
  return { ...command, options, output }
}

/** Returns `stepMessage` with its `amongCommands` piece only when it shows at `verbosity`. */
const keepShownStepMessagePieces = (stepMessage: StepMessage, verbosity: Verbosity): StepMessage => {
  const amongCommands = keepShown(stepMessage.amongCommands, verbosity)
  return { ...stepMessage, amongCommands }
}

/**
 * Returns `detail` with only the pieces inside it that show at `verbosity`: an option's values, the step messages and
 * where each shows, a commands detail's phase headings, and what a command printed.
 */
const keepShownInDetail = (detail: Detail, verbosity: Verbosity): Detail => {
  if (detail.kind === "options") {
    const options = detail.options.map((option) => keepShownOptionValues(option, verbosity))
    return { ...detail, options }
  }

  if (detail.kind === "stepMessages") {
    const shownStepMessages = detail.stepMessages.filter((stepMessage) => isShownAt(stepMessage, verbosity))
    const stepMessages = shownStepMessages.map((stepMessage) => keepShownStepMessagePieces(stepMessage, verbosity))
    return { ...detail, stepMessages }
  }

  if (detail.kind === "commands") {
    const commands = detail.commands.map((command) => keepShownCommandPieces(command, verbosity))
    const phaseHeadings = keepShown(detail.phaseHeadings, verbosity)
    return { ...detail, commands, phaseHeadings }
  }

  return detail
}

/** Keeps the entries that show at `verbosity`, each with only the note parts and details that show. */
const keepShownEntries = (hostBlockEntries: HostBlockEntry[], verbosity: Verbosity): HostBlockEntry[] =>
  hostBlockEntries.flatMap((hostBlockEntry): HostBlockEntry[] => {
    // Keep a host message only when its own level shows, because nothing inside it has a level.
    if (hostBlockEntry.kind === "hostMessage") return isShownAt(hostBlockEntry, verbosity) ? [hostBlockEntry] : []

    const note = hostBlockEntry.note.filter((notePart) => isShownAt(notePart, verbosity))
    const shownDetails = hostBlockEntry.details.filter((detail) => isShownAt(detail, verbosity))
    const details = shownDetails.map((detail) => keepShownInDetail(detail, verbosity))
    // Keep an entry when anything inside it shows, like a warning on a step that was already right, so it can't be missed.
    const isShown = isShownAt(hostBlockEntry, verbosity) || note.length > 0 || details.length > 0
    return isShown ? [{ ...hostBlockEntry, note, details }] : []
  })

/**
 * Returns a host's block with only what shows at `verbosity`: its note, and each entry that shows, with only the pieces
 * that show.
 */
export const toShownHostBlock = (hostBlock: HostBlock, verbosity: Verbosity): HostBlock => {
  const { name, note, entries } = hostBlock
  const shownNote = keepShown(note, verbosity)
  const shownEntries = keepShownEntries(entries, verbosity)
  return { name, note: shownNote, entries: shownEntries }
}

/**
 * Renders a block from `toShownHostBlock` at the level `reportOptions` asks for. Filter first, so nothing hidden is
 * formatted or measured for a column.
 */
export const renderHostBlock = (hostBlock: HostBlock, reportOptions: ReportOptions): string | undefined => {
  const { note, entries } = hostBlock
  // Give a host with nothing to show no block, because its line in the summary already says how it went.
  if (!note && entries.length === 0) return

  // Give the diff limits instead of a level, because computing a full diff only to drop it would be slow.
  const diffLimits = toDiffLimits(reportOptions.verbosity)
  return formatHostBlock(hostBlock, diffLimits)
}
