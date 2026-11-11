import type { Body } from "#report/format/body.ts"
import type { AlignedRow } from "#report/format/details/details.ts"
import type { FormattedEntry } from "#report/format/format.ts"
import type { StatusLine } from "#report/format/status-line.ts"
import { getMaxWidth, padToWidth } from "#utils.ts"

const INDENT = "  "
const DETAIL_INDENT = INDENT.repeat(3)
export const COLUMN_GAP = "   "

/** The width each status line pads its status, its kind, and a name with a note to. */
interface StatusLineColumns {
  status: number
  kind: number
  note: number
}

const getStatusLineColumns = (statusLines: StatusLine[]): StatusLineColumns => ({
  // Pad each status and each kind to the widest in the block, so every kind and every name starts in one column.
  status: getMaxWidth(statusLines.map(({ status }) => status)),
  kind: getMaxWidth(statusLines.map(({ kind }) => kind)),
  // Line up every note in a block in one column, past the longest name that has one.
  note: getMaxWidth(statusLines.filter(({ note }) => note !== undefined).map(({ name }) => name)),
})

const layoutStatusLine = (statusLine: StatusLine, columns: StatusLineColumns): string => {
  const { status, kind, name, note } = statusLine
  const nameText = note === undefined ? name : padToWidth(name, columns.note)
  const noteText = note === undefined ? "" : `${COLUMN_GAP}${note}`
  return `${INDENT}${padToWidth(status, columns.status)} ${padToWidth(kind, columns.kind)} ${nameText}${noteText}`
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

const layoutEntry = (formattedEntry: FormattedEntry, columns: StatusLineColumns): string[] => {
  const { statusLine, body } = formattedEntry
  const bodyLines = layoutBody(body).map((bodyLine) => `${DETAIL_INDENT}${bodyLine}`)
  return [layoutStatusLine(statusLine, columns), ...bodyLines]
}

/** Lays out a host block: its name, then its formatted entries with their columns lined up. */
export const layoutHostBlock = (name: string, formattedEntries: FormattedEntry[]): string => {
  const columns = getStatusLineColumns(formattedEntries.map(({ statusLine }) => statusLine))
  const entryLines = formattedEntries.flatMap((formattedEntry) => layoutEntry(formattedEntry, columns))

  return [name, ...entryLines].join("\n")
}

/** Lays out the block of a host with no steps: its name, then its "no steps" note under it. */
export const layoutNoStepsBlock = (name: string, note: string): string => [name, `${INDENT}${note}`].join("\n")
