import { messageChain } from "ts-explicit-errors"

import type { AlignedRow } from "#report/format/details/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/aligned-row.ts"
import { INDENT } from "#report/format/layout.ts"
import type { CommandOutputDetail } from "#report/host-block/host-block.ts"
import type { Style } from "#styles.ts"
import { styleError, styleNote, styleUnquotedValue, styleValue } from "#styles.ts"
import { getMaxWidth, padToWidth, splitNonEmptyLines } from "#utils.ts"

/**
 * Formats a stream as a row, each line styled, or none when it printed nothing. Trims its trailing whitespace, because
 * the rows are for reading the output, not for its exact value, and keeps its leading whitespace, because that can line
 * up the output.
 */
const formatStreamRows = (label: string, stream: string, style: Style): AlignedRow[] => {
  const trimmedStream = stream.trimEnd()
  const streamLines = trimmedStream.split("\n").map((streamLine) => style(streamLine))
  return trimmedStream === "" ? [] : [formatAlignedRow(label, streamLines)]
}

/**
 * Formats what a command printed as aligned rows: its exit code, even 0, then its stdout and stderr when it printed
 * anything. Shows every line, because the level that shows them is for seeing everything. A command that couldn't run
 * at all shows the error it failed with, in place of its other rows.
 */
const formatCommandOutputRows = (output: CommandOutputDetail): AlignedRow[] => {
  if (output.kind === "failed") {
    const errorLines = splitNonEmptyLines(messageChain(output.error)).map((errorLine) => styleError(errorLine))
    return [formatAlignedRow("error", errorLines)]
  }

  const { exitCode, stdout, stderr } = output
  const exitRow = formatAlignedRow("exit", [styleUnquotedValue(String(exitCode))])
  // Color stderr like an error, like the stderr row under a step that still differs.
  return [exitRow, ...formatStreamRows("stdout", stdout, styleValue), ...formatStreamRows("stderr", stderr, styleError)]
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
