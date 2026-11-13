import { formatLabel } from "#report/format/elements/elements.ts"

/**
 * A formatted `label: value` row, ready for layout to pad its label, with a multi-line value's later lines under its
 * first. Its value lines up with the other aligned rows in the entry.
 */
export interface AlignedRow {
  /** The label, styled and ending with its colon. */
  label: string
  valueLines: string[]
}

/** Returns an aligned row with its label styled and followed by its colon, and its value lines as they're styled. */
export const formatAlignedRow = (label: string, valueLines: string[]): AlignedRow => ({
  label: `${formatLabel(label)} `,
  valueLines,
})
