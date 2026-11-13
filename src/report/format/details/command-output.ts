import { messageChain } from "ts-explicit-errors"

import type { AlignedRow } from "#report/format/details/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/aligned-row.ts"
import { INDENT } from "#report/format/layout.ts"
import type { CommandOutputDetail } from "#report/host-block/host-block.ts"
import { styleError, styleNote, styleUnquotedValue } from "#styles.ts"
import { getMaxWidth, padToWidth, splitNonEmptyLines } from "#utils.ts"

/**
 * Formats what a command printed as aligned rows: its exit code, even 0, or the error it failed with when it couldn't
 * run at all, in place of its other rows.
 */
const formatCommandOutputRows = (output: CommandOutputDetail): AlignedRow[] => {
  if (output.kind === "failed") {
    const errorLines = splitNonEmptyLines(messageChain(output.error)).map((errorLine) => styleError(errorLine))
    return [formatAlignedRow("error", errorLines)]
  }

  return [formatAlignedRow("exit", [styleUnquotedValue(String(output.exitCode))])]
}

/**
 * Formats what a command printed under an `output:` heading at `indent`, with its rows one level deeper and their
 * values lined up among themselves. Use a heading, because the rows would otherwise read like more of the command's
 * text.
 */
export const formatCommandOutputLines = (output: CommandOutputDetail, indent: string): string[] => {
  const outputRows = formatCommandOutputRows(output)
  const labelWidth = getMaxWidth(outputRows.map(({ label }) => label))
  const continuationIndent = " ".repeat(labelWidth)

  const rowLines = outputRows.flatMap(({ label, valueLines }) =>
    valueLines.map((valueLine, index) => {
      const lineStart = index === 0 ? padToWidth(label, labelWidth) : continuationIndent
      return `${indent}${INDENT}${lineStart}${valueLine}`
    }),
  )
  return [`${indent}${styleNote("output:")}`, ...rowLines]
}
