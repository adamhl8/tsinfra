import pc from "picocolors"
import { messageChain } from "ts-explicit-errors"

import type { HostReport } from "#hosts/run.ts"
import type { Detail, EntryKind, EntryStatus, NameKind, StepEntry } from "#report/entries.ts"
import { toStepEntries } from "#report/entries.ts"
import { formatDiff } from "#report/format/diff.ts"
import { toEnsureRows } from "#report/format/ensure.ts"
import { toFileRows } from "#report/format/file.ts"
import { toLinkRows } from "#report/format/link.ts"
import type { Style } from "#report/format/styles.ts"
import { STATUS_STYLES, styleError, styleNote, styleValue } from "#report/format/styles.ts"
import { getMaxWidth, padToWidth, quoteNames } from "#utils.ts"

const INDENT = "  "
const DETAIL_INDENT = INDENT.repeat(3)
export const COLUMN_GAP = "   "

export interface FormatOptions {
  /** Shows every step, even the ones that didn't change anything. */
  verbose?: boolean
}

/** One printed `label: value` row, with a multi-line value's later lines under its first. */
export interface LabelRow {
  label: string
  valueLines: string[]
}

// Style a value name, because it's a command, a path, or a target, and a host script in italics, because it isn't a step.
const NAME_STYLES: Record<NameKind, Style> = {
  step: (name) => name,
  value: styleValue,
  hostScript: pc.italic,
}

/** Styles each line of `text` on its own, so a continuation line starts in the color too. */
const styleLines = (text: string, style: Style): string =>
  text
    .split("\n")
    .map((textLine) => style(textLine))
    .join("\n")

/** Returns the `label: value` rows a detail prints as. A diff or a note has none, because it prints as lines of its own. */
const toLabelRows = (detail: Detail): LabelRow[] => {
  if (detail.kind === "diff" || detail.kind === "note") return []

  if (detail.kind === "ensureComparisonValues") return toEnsureRows(detail.values)
  if (detail.kind === "fileComparisonValues") return toFileRows(detail.values)
  if (detail.kind === "linkComparisonValues") return toLinkRows(detail.values)

  // Color stderr like an error, so it stands apart from its command, and leave the arrow between them uncolored.
  const { command, stderr } = detail
  const valueText = `${styleLines(command, styleValue)} -> ${styleLines(stderr, styleError)}`
  return [{ label: "stderr", valueLines: valueText.split("\n") }]
}

/** Formats rows as `label: value` lines, with each value starting at `valueColumn`. */
const formatLabelRows = (labelRows: LabelRow[], valueColumn: number): string[] => {
  const continuationIndent = " ".repeat(valueColumn)

  return labelRows.flatMap(({ label, valueLines }) => {
    // Dim the label, so the value is what stands out.
    const labelText = pc.dim(padToWidth(`${label}: `, valueColumn))
    return valueLines.map((valueLine, index) => `${index === 0 ? labelText : continuationIndent}${valueLine}`)
  })
}

/**
 * Formats the lines under an entry's head line: its error in red, if any, then its details. Lines up the values of
 * every `label: value` row in the entry in one column. Indents the details under an error, so an error stands apart and
 * its details read as belonging to it.
 */
const formatEntryBody = (stepEntry: StepEntry, formatOptions: FormatOptions): string[] => {
  const { error, details = [] } = stepEntry
  const labels = details.flatMap((detail) => toLabelRows(detail)).map(({ label }) => `${label}: `)
  const valueColumn = getMaxWidth(labels)

  const detailLines = details.flatMap((detail) => {
    if (detail.kind === "diff") return formatDiff(detail.got, detail.want, formatOptions)
    if (detail.kind === "note") return [styleNote(detail.text)]
    return formatLabelRows(toLabelRows(detail), valueColumn)
  })
  if (!error) return detailLines

  const errorLines = messageChain(error)
    .split("\n")
    .map((errorLine) => styleError(errorLine))
  return [...errorLines, ...detailLines.map((detailLine) => `${INDENT}${detailLine}`)]
}

/** Formats a waiting step's step note, like `needs 'A', 'B'`. */
const formatNeedsNote = (needs: string[]): string => `needs ${quoteNames(needs)}`

/** Formats an entry's status as its symbol and its word, like `~ change`. */
const formatStatus = (status: EntryStatus): string => {
  const { symbol, word } = STATUS_STYLES[status]
  return `${symbol} ${word}`
}

/** Formats an entry's kind, like `(file)`, so it reads apart from the name even without color. */
const formatEntryKind = (entryKind: EntryKind): string => `(${entryKind})`

// Dim the kind, so the name stays the main thing on the line.
// Italicize `(host)` too, so a failure no step owns doesn't read as a kind of step.
const styleEntryKind = (entryKind: EntryKind, text: string): string =>
  entryKind === "host" ? pc.italic(pc.dim(text)) : pc.dim(text)

const formatStepEntries = (stepEntries: StepEntry[], formatOptions: FormatOptions): string[] => {
  // Pad each status and each kind to the widest in the block, so every kind and every name starts in one column.
  const statusColumn = getMaxWidth(stepEntries.map(({ status }) => `${formatStatus(status)}:`))
  const entryKindColumn = getMaxWidth(stepEntries.map(({ kind }) => formatEntryKind(kind)))
  // Line up every step note in a block in one column, past the longest name that has one.
  const stepNoteColumn = getMaxWidth(stepEntries.filter(({ needs }) => needs).map(({ name }) => name.text))

  return stepEntries.flatMap((stepEntry) => {
    const { status, kind, name, needs } = stepEntry
    const { color } = STATUS_STYLES[status]
    const stepNote = needs ? formatNeedsNote(needs) : undefined

    const entryKindText = styleEntryKind(kind, padToWidth(formatEntryKind(kind), entryKindColumn))

    const styledName = NAME_STYLES[name.kind](name.text)
    const nameText = stepNote ? padToWidth(styledName, stepNoteColumn) : styledName
    // Dim a step note, so the step's name stays the main thing on the line.
    const stepNoteText = stepNote ? `${COLUMN_GAP}${pc.dim(stepNote)}` : ""
    // Leave the colon uncolored, so it reads as punctuation between the status and the kind.
    const statusText = padToWidth(`${color(formatStatus(status))}:`, statusColumn)
    const headLine = `${INDENT}${statusText} ${entryKindText} ${nameText}${stepNoteText}`
    const bodyLines = formatEntryBody(stepEntry, formatOptions).map((bodyLine) => `${DETAIL_INDENT}${bodyLine}`)

    return [headLine, ...bodyLines]
  })
}

/**
 * Formats a host's block: its name, then an entry for each step that changed, ran, waits, or failed. With `verbose`,
 * every step gets an entry, and a host with no steps still gets a block, so it's clear the host ran.
 */
export const formatHostBlock = (hostReport: HostReport, formatOptions: FormatOptions = {}): string | undefined => {
  const { name } = hostReport
  const { verbose = false } = formatOptions
  const stepEntries = toStepEntries(hostReport, formatOptions)

  if (stepEntries.length === 0 && verbose) return [pc.bold(name), `${INDENT}${styleNote("no steps")}`].join("\n")
  if (stepEntries.length === 0) return

  return [pc.bold(name), ...formatStepEntries(stepEntries, formatOptions)].join("\n")
}
