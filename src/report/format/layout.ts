import type { Body } from "#report/format/body.ts"
import type { AlignedRow } from "#report/format/details/details.ts"
import type { FormattedEntry } from "#report/format/format.ts"
import type { StatusLine } from "#report/format/status-line.ts"
import { getMaxWidth, padToWidth } from "#utils.ts"

const INDENT = "  "
const DETAIL_INDENT = INDENT.repeat(3)
export const COLUMN_GAP = "   "

/**
 * The width each status line pads its status, kind, name, and options to, so the next column starts in one place on
 * every line. The note comes last, so nothing pads it.
 */
interface StatusLineWidths {
  status: number
  kind: number
  name: number
  options: number
}

const getStatusLineWidths = (statusLines: StatusLine[]): StatusLineWidths => {
  const noteLines = statusLines.filter(({ note }) => note !== undefined)
  const optionsOrNoteLines = statusLines.filter(({ options, note }) => options !== undefined || note !== undefined)

  return {
    // Pad each status and each kind to the widest in the block, so every kind and every name starts in one column.
    status: getMaxWidth(statusLines.map(({ status }) => status)),
    kind: getMaxWidth(statusLines.map(({ kind }) => kind)),
    // Line up every line's options and note past the longest name that has either.
    name: getMaxWidth(optionsOrNoteLines.map(({ name }) => name)),
    // Line up every note past the widest options of the lines that have a note.
    options: getMaxWidth(noteLines.map(({ options }) => options ?? "")),
  }
}

const layoutStatusLine = (statusLine: StatusLine, widths: StatusLineWidths): string => {
  const { status, kind, name, options, note } = statusLine
  const statusAndKind = `${INDENT}${padToWidth(status, widths.status)} ${padToWidth(kind, widths.kind)} `
  if (options === undefined && note === undefined) return `${statusAndKind}${name}`

  // Pad only a line with options or a note, because the name column is the widest name among those lines.
  const nameText = padToWidth(name, widths.name)
  if (note === undefined) return `${statusAndKind}${nameText}${COLUMN_GAP}${options}`

  // Leave the options slot blank on a note's line without options, so every note starts in one column.
  const optionsText = widths.options > 0 ? `${padToWidth(options ?? "", widths.options)}${COLUMN_GAP}` : ""
  return `${statusAndKind}${nameText}${COLUMN_GAP}${optionsText}${note}`
}

/** Lays out aligned rows as `label: value` lines, with each value starting at `valueColumn`. */
const layoutAlignedRows = (alignedRows: AlignedRow[], valueColumn: number): string[] => {
  const continuationIndent = " ".repeat(valueColumn)

  return alignedRows.flatMap(({ label, valueLines }) => {
    const labelText = padToWidth(label, valueColumn)
    return valueLines.map((valueLine, index) => `${index === 0 ? labelText : continuationIndent}${valueLine}`)
  })
}

/**
 * Lays out the lines under a status line: its error, if any, then its details. Lines up the values of every aligned row
 * in the entry in one column. Indents the details under an error, so an error stands apart and its details read as
 * belonging to it.
 */
const layoutBody = (body: Body): string[] => {
  const { errorLines, detailRows } = body

  const labels = detailRows.flatMap(({ kind, rows }) => (kind === "aligned" ? rows.map(({ label }) => label) : []))
  const valueColumn = getMaxWidth(labels)

  const detailLines = detailRows.flatMap(({ kind, rows }) =>
    kind === "aligned" ? layoutAlignedRows(rows, valueColumn) : rows,
  )
  if (!errorLines) return detailLines

  const indentedDetailLines = detailLines.map((detailLine) => `${INDENT}${detailLine}`)
  return [...errorLines, ...indentedDetailLines]
}

const layoutEntry = (formattedEntry: FormattedEntry, widths: StatusLineWidths): string[] => {
  const { statusLine, body } = formattedEntry
  const bodyLines = layoutBody(body).map((bodyLine) => `${DETAIL_INDENT}${bodyLine}`)
  return [layoutStatusLine(statusLine, widths), ...bodyLines]
}

/** Lays out a host block: its name, then its formatted entries with their columns lined up. */
export const layoutHostBlock = (name: string, formattedEntries: FormattedEntry[]): string => {
  const widths = getStatusLineWidths(formattedEntries.map(({ statusLine }) => statusLine))
  const entryLines = formattedEntries.flatMap((formattedEntry) => layoutEntry(formattedEntry, widths))

  return [name, ...entryLines].join("\n")
}

/** Lays out the block of a host with no steps: its name, then its "no steps" note under it. */
export const layoutNoStepsBlock = (name: string, note: string): string => [name, `${INDENT}${note}`].join("\n")
