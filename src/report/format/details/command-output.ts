import { messageChain } from "ts-explicit-errors"

import type { AlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { formatAlignedRow, formatHeadingRow } from "#report/format/details/shared/aligned-row.ts"
import { errorLineElement } from "#report/format/elements/asides.ts"
import { stderrLineElement, stdoutLineElement } from "#report/format/elements/commands.ts"
import { exitCodeElement } from "#report/format/elements/values.ts"
import { layoutRowsInOwnColumn } from "#report/format/layout.ts"
import type { CommandOutputDetail } from "#report/host-block.ts"
import { splitNonEmptyLines } from "#utils.ts"

/**
 * Formats a stream as a row, each line styled, or none when it printed nothing. Trims its trailing whitespace, because
 * the rows are for reading the output, not for its exact value, and keeps its leading whitespace, because that can line
 * up the output.
 */
const formatStreamRows = (label: string, stream: string, lineElement: (line: string) => string): AlignedRow[] => {
  const trimmedStream = stream.trimEnd()
  const streamLines = trimmedStream.split("\n").map((streamLine) => lineElement(streamLine))
  return trimmedStream === "" ? [] : [formatAlignedRow(label, streamLines)]
}

/**
 * Formats what a command printed as aligned rows: its exit code, even 0, then its stdout and stderr when it printed
 * anything. Shows every line, because the level that shows them is for seeing everything. A command that couldn't run
 * at all shows the error it failed with, in place of its other rows.
 */
const formatCommandOutputRows = (output: CommandOutputDetail): AlignedRow[] => {
  if (output.kind === "failed") {
    const errorLines = splitNonEmptyLines(messageChain(output.error)).map((errorLine) => errorLineElement(errorLine))
    return [formatAlignedRow("error", errorLines)]
  }

  const { exitCode, stdout, stderr } = output
  const exitRow = formatAlignedRow("exit", [exitCodeElement(exitCode)])
  return [
    exitRow,
    ...formatStreamRows("stdout", stdout, stdoutLineElement),
    ...formatStreamRows("stderr", stderr, stderrLineElement),
  ]
}

/**
 * Formats what a command printed under an `output:` heading at `indent`, with its rows one level deeper and their
 * values lined up among themselves. Use a heading, because the rows would otherwise read like more of the command's
 * text.
 */
export const formatCommandOutputLines = (output: CommandOutputDetail, indent: string): string[] =>
  layoutRowsInOwnColumn([formatHeadingRow("output", formatCommandOutputRows(output))]).map((line) => `${indent}${line}`)
