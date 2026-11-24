import type { FormattedEntry, FormattedHostBlock } from "#report/format.ts"
import type { Body } from "#report/format/body.ts"
import type { DetailRows } from "#report/format/details.ts"
import type { AlignedRow } from "#report/format/details/shared/aligned-row.ts"
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
  const lineParts = [status, kind, name].filter((part) => part !== undefined)
  const line = `${INDENT}${lineParts.join(" ")}`
  return note === undefined ? line : `${line}${COLUMN_GAP}${note}`
}

/** Returns the column the values of `alignedRows` line up in, from the labels of the rows that have a value. */
const getValueColumn = (alignedRows: AlignedRow[]): number =>
  getMaxWidth(alignedRows.filter(({ nestedRows }) => !nestedRows).map(({ label }) => label))

/**
 * Lays out aligned rows as `label: value` lines, with each value starting at `valueColumn`. A row with nested rows gets
 * its label on a line of its own, then its nested rows indented one level, aligned ones lined up in a column of their
 * own.
 */
const layoutAlignedRows = (alignedRows: AlignedRow[], valueColumn: number): string[] => {
  const continuationIndent = " ".repeat(valueColumn)

  return alignedRows.flatMap(({ label, valueLines, nestedRows }) => {
    if (nestedRows) {
      // Line up nested rows among themselves, whether or not they're in their own column, because they're under a label.
      const nestedLines =
        nestedRows.kind === "unaligned"
          ? nestedRows.rows
          : layoutAlignedRows(nestedRows.rows, getValueColumn(nestedRows.rows))
      return [label, ...nestedLines.map((nestedLine) => `${INDENT}${nestedLine}`)]
    }

    const labelText = padToWidth(label, valueColumn)
    return valueLines.map((valueLine, index) => `${index === 0 ? labelText : continuationIndent}${valueLine}`)
  })
}

/** Lays out aligned rows in a column of their own, apart from the entry's, like an options block under a command. */
export const layoutRowsInOwnColumn = (alignedRows: AlignedRow[]): string[] =>
  layoutAlignedRows(alignedRows, getValueColumn(alignedRows))

/** Lays out one detail's rows: aligned ones at the entry's `valueColumn`, and unaligned ones as they are. */
const layoutDetailRows = (detailRows: DetailRows, valueColumn: number): string[] =>
  detailRows.kind === "aligned" ? layoutAlignedRows(detailRows.rows, valueColumn) : detailRows.rows

/**
 * Lays out the lines under a status line: its error, if any, then its details. Lines up the values of every aligned row
 * in the entry in one column. Indents the details under an error, so an error stands apart and its details read as
 * belonging to it.
 */
const layoutBody = (body: Body): string[] => {
  const { errorLines, detailRows } = body

  const valueColumn = getValueColumn(detailRows.flatMap(({ kind, rows }) => (kind === "aligned" ? rows : [])))

  const detailLines = detailRows.flatMap((formattedDetail) => layoutDetailRows(formattedDetail, valueColumn))
  if (!errorLines) return detailLines

  const indentedDetailLines = detailLines.map((detailLine) => `${INDENT}${detailLine}`)
  return [...errorLines, ...indentedDetailLines]
}

const layoutEntry = (formattedEntry: FormattedEntry): string[] => {
  // Lay out a message's row in a column of its own, so its text's later lines line up under its first.
  if (formattedEntry.kind === "hostMessage")
    return layoutRowsInOwnColumn([formattedEntry.row]).map((messageLine) => `${INDENT}${messageLine}`)

  const { statusLine, body } = formattedEntry
  const bodyLines = layoutBody(body).map((bodyLine) => `${DETAIL_INDENT}${bodyLine}`)
  return [layoutStatusLine(statusLine), ...bodyLines]
}

/** Lays out a host block: its name, then its note under it, if it has one, then each of its formatted entries. */
export const layoutHostBlock = (formattedHostBlock: FormattedHostBlock): string => {
  const { name, note, entries } = formattedHostBlock
  const noteLines = note === undefined ? [] : [`${INDENT}${note}`]
  const entryLines = entries.flatMap((formattedEntry) => layoutEntry(formattedEntry))

  return [name, ...noteLines, ...entryLines].join("\n")
}
