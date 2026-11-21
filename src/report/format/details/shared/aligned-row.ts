import type { DetailRows } from "#report/format/details.ts"
import type { HeadingName } from "#report/format/elements/labels.ts"
import { headingElement, labelElement } from "#report/format/elements/labels.ts"
import { keyElement } from "#report/format/elements/values.ts"

/**
 * A formatted `label: value` row, ready for layout to pad its label, with a multi-line value's later lines under its
 * first. Its value lines up with the other aligned rows in the entry.
 */
export interface AlignedRow {
  /** The label, styled and ending with its colon. */
  label: string
  valueLines: string[]
  /**
   * The rows under the label, in place of a value, indented one level: aligned rows lined up among themselves, or lines
   * as they are, like a diff's. Its label stays out of the column the other rows line up in, because it has no value to
   * line up.
   */
  nestedRows?: DetailRows
}

/** Returns an aligned row with its label styled and followed by its colon, and its value lines as they're styled. */
export const formatAlignedRow = (label: string, valueLines: string[]): AlignedRow => ({
  label: `${labelElement(label)} `,
  valueLines,
})

/** Returns a row headed by `label`, like an option's `env:`, with `nestedRows` under it in place of a value. */
export const formatLabelHeadingRow = (label: string, nestedRows: AlignedRow[]): AlignedRow => ({
  label: labelElement(label),
  valueLines: [],
  nestedRows: { kind: "aligned", rows: nestedRows },
})

/** Returns an aligned row labeled by a key of an object, like `pnpm:`. */
export const formatKeyRow = (key: string, valueLines: string[]): AlignedRow => ({
  label: `${keyElement(key)} `,
  valueLines,
})

/** Returns a row labeled by a key of an object, like `env:`, with `nestedRows` under it in place of a value. */
export const formatKeyHeadingRow = (key: string, nestedRows: DetailRows): AlignedRow => ({
  label: keyElement(key),
  valueLines: [],
  nestedRows,
})

/** Returns a row headed like `options:`, with `nestedRows` under it in place of a value. */
export const formatHeadingRow = (name: HeadingName, nestedRows: AlignedRow[]): AlignedRow => ({
  label: headingElement(name),
  valueLines: [],
  nestedRows: { kind: "aligned", rows: nestedRows },
})

/** Returns the lines `alignedRows` take up, counting each heading and the rows or lines under it. */
export const countRowLines = (alignedRows: AlignedRow[]): number =>
  alignedRows
    .map(({ valueLines, nestedRows }) => {
      if (!nestedRows) return valueLines.length
      const nestedLineCount = nestedRows.kind === "aligned" ? countRowLines(nestedRows.rows) : nestedRows.rows.length
      return 1 + nestedLineCount
    })
    .reduce((lineCount, rowLineCount) => lineCount + rowLineCount, 0)
