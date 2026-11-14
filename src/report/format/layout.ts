import type { Body } from "#report/format/body.ts"
import type { AlignedRow } from "#report/format/details/details.ts"
import type { FormattedEntry } from "#report/format/format.ts"
import type { StatusLine } from "#report/format/status-line.ts"
import { getMaxWidth, padToWidth } from "#utils.ts"

export const INDENT = "  "
const DETAIL_INDENT = INDENT.repeat(3)
export const COLUMN_GAP = "   "

/**
 * Lays out an entry's status line on its own, with no padding to match the other entries, so each entry stands alone.
 * Puts a gap before the note, so it reads apart from the name.
 */
const layoutStatusLine = (statusLine: StatusLine): string => {
  const { status, kind, name, note } = statusLine
  const line = `${INDENT}${status} ${kind} ${name}`
  return note === undefined ? line : `${line}${COLUMN_GAP}${note}`
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

const layoutEntry = (formattedEntry: FormattedEntry): string[] => {
  const { statusLine, body } = formattedEntry
  const bodyLines = layoutBody(body).map((bodyLine) => `${DETAIL_INDENT}${bodyLine}`)
  return [layoutStatusLine(statusLine), ...bodyLines]
}

/** Lays out a host block: its name, then each of its formatted entries. */
export const layoutHostBlock = (name: string, formattedEntries: FormattedEntry[]): string => {
  const entryLines = formattedEntries.flatMap((formattedEntry) => layoutEntry(formattedEntry))

  return [name, ...entryLines].join("\n")
}

/** Lays out the block of a host with no steps: its name, then its "no steps" note under it. */
export const layoutNoStepsBlock = (name: string, note: string): string => [name, `${INDENT}${note}`].join("\n")
