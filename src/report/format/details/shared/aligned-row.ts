import type { DetailRows } from "#report/format/details.ts"
import type { HeadingName } from "#report/format/elements/labels.ts"
import { headingElement, labelElement } from "#report/format/elements/labels.ts"
import { keyElement } from "#report/format/elements/values.ts"

/** A formatted row that starts with a label, ready for layout: one with a value, or one that heads other rows. */
export type AlignedRow = ValueRow | HeadingRow

interface BaseAlignedRow {
  /** The label, styled and ending with its colon. */
  label: string
}

/**
 * A `label: value` row. Layout pads its label, so its value lines up with the other value rows in the entry, and puts a
 * multi-line value's later lines under its first.
 */
interface ValueRow extends BaseAlignedRow {
  kind: "value"
  valueLines: string[]
}

/**
 * A row with other rows under its label, in place of a value. Its label stays out of the column the value rows line up
 * in, because it has no value to line up.
 */
interface HeadingRow extends BaseAlignedRow {
  kind: "heading"
  /**
   * The rows under the label, indented one level: aligned rows lined up among themselves, or lines as they are, like a
   * diff's.
   */
  nestedRows: DetailRows
}

/** Returns an aligned row with its label styled and followed by its colon, and its value lines as they're styled. */
export const formatAlignedRow = (label: string, valueLines: string[]): AlignedRow => ({
  kind: "value",
  label: `${labelElement(label)} `,
  valueLines,
})

/** Returns a row headed by `label`, like an option's `env:`, with `nestedRows` under it in place of a value. */
export const formatLabelHeadingRow = (label: string, nestedRows: AlignedRow[]): AlignedRow => ({
  kind: "heading",
  label: labelElement(label),
  nestedRows: { kind: "aligned", rows: nestedRows },
})

/** Returns an aligned row labeled by a key of an object, like `pnpm:`. */
export const formatKeyRow = (key: string, valueLines: string[]): AlignedRow => ({
  kind: "value",
  label: `${keyElement(key)} `,
  valueLines,
})

/** Returns a row labeled by a key of an object, like `env:`, with `nestedRows` under it in place of a value. */
export const formatKeyHeadingRow = (key: string, nestedRows: DetailRows): AlignedRow => ({
  kind: "heading",
  label: keyElement(key),
  nestedRows,
})

/** Returns a row headed like `options:`, with `nestedRows` under it in place of a value. */
export const formatHeadingRow = (name: HeadingName, nestedRows: AlignedRow[]): AlignedRow => ({
  kind: "heading",
  label: headingElement(name),
  nestedRows: { kind: "aligned", rows: nestedRows },
})

/** Returns the lines `alignedRows` take up, counting each heading and the rows or lines under it. */
export const countRowLines = (alignedRows: AlignedRow[]): number =>
  alignedRows
    .map((alignedRow) => {
      if (alignedRow.kind === "value") return alignedRow.valueLines.length

      const { nestedRows } = alignedRow
      const nestedLineCount = nestedRows.kind === "aligned" ? countRowLines(nestedRows.rows) : nestedRows.rows.length
      return 1 + nestedLineCount
    })
    .reduce((lineCount, rowLineCount) => lineCount + rowLineCount, 0)
