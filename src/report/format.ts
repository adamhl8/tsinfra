import { messageChain } from "ts-explicit-errors"

import type { HostReport } from "#hosts/run.ts"
import type { Detail, StepEntryKind, StepEntryStatus, NameKind, StepEntry } from "#report/entries.ts"
import { toStepEntries } from "#report/entries.ts"
import { formatDiff } from "#report/format/diff.ts"
import { toEnsureRows } from "#report/format/ensure.ts"
import { toFileRows } from "#report/format/file.ts"
import { toLinkRows } from "#report/format/link.ts"
import type { Style } from "#report/format/styles.ts"
import {
  STATUS_STYLES,
  styleAside,
  styleError,
  styleHostKind,
  styleHostName,
  styleHostScript,
  styleLabel,
  styleNote,
  styleValue,
  styleWarning,
} from "#report/format/styles.ts"
import type { StepWarning } from "#report/warnings.ts"
import { getMaxWidth, padToWidth, quoteNames } from "#utils.ts"

const INDENT = "  "
const DETAIL_INDENT = INDENT.repeat(3)
export const COLUMN_GAP = "   "

export interface FormatOptions {
  /** Shows every step, even the ones that didn't change anything. */
  verbose?: boolean
}

/** A `label: value` row, with a multi-line value's later lines under its first, whose value lines up with the others. */
export interface AlignedRow {
  label: string
  valueLines: string[]
}

// Style a value name, because it's a command, a path, or a target.
const NAME_STYLES: Record<NameKind, Style> = {
  step: (name) => name,
  value: styleValue,
  hostScript: styleHostScript,
}

/** Styles each line of `text` on its own, so a continuation line starts in the color too. */
const styleLines = (text: string, style: Style): string =>
  text
    .split("\n")
    .map((textLine) => style(textLine))
    .join("\n")

/**
 * Formats a warning, like `warning: nothing exists at target -> /x`, with the value it's about after its words. Colors
 * only the label and the value, so the words read like the rest of the details.
 */
const formatWarning = (warning: StepWarning): string => {
  const { text, value } = warning
  const valueText = value === undefined ? "" : ` ${styleValue(value)}`
  return `${styleWarning("warning:")} ${text}${valueText}`
}

/**
 * The rows a detail prints as. A row is one or more lines. Aligned rows line up their values in one column with the
 * entry's other aligned rows, and unaligned rows, like a diff's lines, print as they are.
 */
type DetailRows = { kind: "aligned"; rows: AlignedRow[] } | { kind: "unaligned"; rows: string[] }

/** Returns the rows a detail prints as, aligned or not. */
const toDetailRows = (detail: Detail, formatOptions: FormatOptions): DetailRows => {
  if (detail.kind === "diff") return { kind: "unaligned", rows: formatDiff(detail.got, detail.want, formatOptions) }
  if (detail.kind === "note") return { kind: "unaligned", rows: [styleNote(detail.text)] }
  if (detail.kind === "warning") return { kind: "unaligned", rows: [formatWarning(detail.warning)] }
  if (detail.kind === "ensureComparisonValues") return { kind: "aligned", rows: toEnsureRows(detail.values) }
  if (detail.kind === "fileComparisonValues") return { kind: "aligned", rows: toFileRows(detail.values) }
  if (detail.kind === "linkComparisonValues") return { kind: "aligned", rows: toLinkRows(detail.values) }

  // Color stderr like an error, so it stands apart from its command, and leave the arrow between them uncolored.
  const { command, stderr } = detail
  const valueText = `${styleLines(command, styleValue)} -> ${styleLines(stderr, styleError)}`
  return { kind: "aligned", rows: [{ label: "stderr", valueLines: valueText.split("\n") }] }
}

/** Formats aligned rows as `label: value` lines, with each value starting at `valueColumn`. */
const formatAlignedRows = (alignedRows: AlignedRow[], valueColumn: number): string[] => {
  const continuationIndent = " ".repeat(valueColumn)

  return alignedRows.flatMap(({ label, valueLines }) => {
    const labelText = styleLabel(padToWidth(`${label}: `, valueColumn))
    return valueLines.map((valueLine, index) => `${index === 0 ? labelText : continuationIndent}${valueLine}`)
  })
}

/**
 * Formats the lines under a step entry's head line: its error in red, if any, then its details. Lines up the values of
 * every aligned row in the entry in one column. Indents the details under an error, so an error stands apart and its
 * details read as belonging to it.
 */
const formatStepEntryBody = (stepEntry: StepEntry, formatOptions: FormatOptions): string[] => {
  const { error, details = [] } = stepEntry
  const detailRows = details.map((detail) => toDetailRows(detail, formatOptions))

  const labels = detailRows.flatMap(({ kind, rows }) =>
    kind === "aligned" ? rows.map(({ label }) => `${label}: `) : [],
  )
  const valueColumn = getMaxWidth(labels)

  const detailLines = detailRows.flatMap(({ kind, rows }) =>
    kind === "aligned" ? formatAlignedRows(rows, valueColumn) : rows,
  )
  if (!error) return detailLines

  const errorLines = messageChain(error)
    .split("\n")
    .map((errorLine) => styleError(errorLine))
  return [...errorLines, ...detailLines.map((detailLine) => `${INDENT}${detailLine}`)]
}

/** Formats a waiting step's step note, like `needs 'A', 'B'`. */
const formatNeedsNote = (needs: string[]): string => `needs ${quoteNames(needs)}`

/** Formats a step entry's status as its symbol and its word, like `~ change`. */
const formatStatus = (status: StepEntryStatus): string => {
  const { symbol, word } = STATUS_STYLES[status]
  return `${symbol} ${word}`
}

/** Formats a step entry's kind, like `(file)`, so it reads apart from the name even without color. */
const formatStepEntryKind = (stepEntryKind: StepEntryKind): string => `(${stepEntryKind})`

const styleStepEntryKind = (stepEntryKind: StepEntryKind, text: string): string =>
  stepEntryKind === "host" ? styleHostKind(text) : styleLabel(text)

const formatStepEntries = (stepEntries: StepEntry[], formatOptions: FormatOptions): string[] => {
  // Pad each status and each kind to the widest in the block, so every kind and every name starts in one column.
  const statusColumn = getMaxWidth(stepEntries.map(({ status }) => `${formatStatus(status)}:`))
  const stepEntryKindColumn = getMaxWidth(stepEntries.map(({ kind }) => formatStepEntryKind(kind)))
  // Line up every step note in a block in one column, past the longest name that has one.
  const stepNoteColumn = getMaxWidth(stepEntries.filter(({ needs }) => needs).map(({ name }) => name.text))

  return stepEntries.flatMap((stepEntry) => {
    const { status, kind, name, needs } = stepEntry
    const { color } = STATUS_STYLES[status]
    const stepNote = needs ? formatNeedsNote(needs) : undefined

    const stepEntryKindText = styleStepEntryKind(kind, padToWidth(formatStepEntryKind(kind), stepEntryKindColumn))

    const styledName = NAME_STYLES[name.kind](name.text)
    const nameText = stepNote ? padToWidth(styledName, stepNoteColumn) : styledName
    const stepNoteText = stepNote ? `${COLUMN_GAP}${styleAside(stepNote)}` : ""
    // Leave the colon uncolored, so it reads as punctuation between the status and the kind.
    const statusText = padToWidth(`${color(formatStatus(status))}:`, statusColumn)
    const headLine = `${INDENT}${statusText} ${stepEntryKindText} ${nameText}${stepNoteText}`
    const bodyLines = formatStepEntryBody(stepEntry, formatOptions).map((bodyLine) => `${DETAIL_INDENT}${bodyLine}`)

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

  if (stepEntries.length === 0 && verbose) return [styleHostName(name), `${INDENT}${styleNote("no steps")}`].join("\n")
  if (stepEntries.length === 0) return

  return [styleHostName(name), ...formatStepEntries(stepEntries, formatOptions)].join("\n")
}
