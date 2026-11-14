import { diffArrays } from "diff"

import type { AlignedRow } from "#report/format/details/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/aligned-row.ts"
import type { DetailRows } from "#report/format/details/details.ts"
import type { DiffLimits } from "#report/format/details/diff.ts"
import { FULL_DIFF_TIMEOUT_MS, LINE_LIMIT_FLAG, TIME_LIMIT_FLAG } from "#report/format/details/diff.ts"
import { gotValueElement, noteElement, wantValueElement } from "#report/format/elements/elements.ts"
import type { EnsureComparisonValues } from "#session/session.ts"

/**
 * Formats the note in place of values that took too long to compare, naming the flag that shows them only when one
 * does.
 */
const formatSlowCompareNote = (hasTimeLimit: boolean): string =>
  noteElement(`values took too long to compare${hasTimeLimit ? `, run with ${TIME_LIMIT_FLAG} to see them` : ""}`)

/** Formats the note in place of `lineCount` differing lines, which are too many to show. */
const formatManyLinesNote = (lineCount: number): string =>
  noteElement(`${lineCount} lines differ, run with ${LINE_LIMIT_FLAG} to see them`)

type NonStringValues = Exclude<EnsureComparisonValues, { kind: "string" }>

// Describe an exit code in words, because a bare `1` would be hard to read.
const describeExitCode = (exitCode: number) => `exit code ${exitCode}`
const describeWantedExit = (wantsZero: boolean) => (wantsZero ? "exit code 0" : "a non-zero exit code")

/** Formats the `got` and `want` rows of a comparison whose values aren't strings. */
const formatNonStringRows = (values: NonStringValues): AlignedRow[] => {
  const got = values.kind === "exit" ? gotValueElement(values.got, describeExitCode) : gotValueElement(values.got)
  const want =
    values.kind === "exit" ? wantValueElement(values.want, describeWantedExit) : wantValueElement(values.want)
  return [formatAlignedRow("got", [got]), formatAlignedRow("want", [want])]
}

/** Splits a compared string into its lines. An empty string has none, so it can't count as one empty line. */
const splitLines = (text: string): string[] => (text === "" ? [] : text.split("\n"))

/**
 * Returns a side's row: a marker for an empty value, its differing lines, or nothing when every line it has is also in
 * the other side.
 */
const toSideRows = (
  label: string,
  value: string,
  differingLines: string[],
  sideValueElement: (value: string) => string,
): AlignedRow[] => {
  if (value === "") return [formatAlignedRow(label, [sideValueElement(value)])]
  if (differingLines.length === 0) return []
  return [
    formatAlignedRow(
      label,
      differingLines.map((line) => sideValueElement(line)),
    ),
  ]
}

/**
 * Formats two strings as `got` and `want` rows that hold only the lines that differ, so a long list with one change
 * stays short. Lines that go past one of `diffLimits` become a note that names the flag that shows them.
 */
const formatStringValues = (got: string, want: string, diffLimits: DiffLimits): DetailRows => {
  const timeout = diffLimits.timeoutMs ?? FULL_DIFF_TIMEOUT_MS
  const changes = diffArrays(splitLines(got), splitLines(want), { timeout })

  if (changes === undefined)
    return { kind: "unaligned", rows: [formatSlowCompareNote(diffLimits.timeoutMs !== undefined)] }

  const gotLines = changes.filter((change) => change.removed).flatMap((change) => change.value)
  const wantLines = changes.filter((change) => change.added).flatMap((change) => change.value)
  const lineCount = gotLines.length + wantLines.length
  if (diffLimits.maxLines !== undefined && lineCount > diffLimits.maxLines)
    return { kind: "unaligned", rows: [formatManyLinesNote(lineCount)] }

  const rows = [
    ...toSideRows("got", got, gotLines, gotValueElement),
    ...toSideRows("want", want, wantLines, wantValueElement),
  ]
  return { kind: "aligned", rows }
}

/** Formats what an `ensure` compared as its `got` and `want` rows, or a note when a string's lines can't show. */
export const formatEnsureValues = (values: EnsureComparisonValues, diffLimits: DiffLimits): DetailRows => {
  if (values.kind === "string") return formatStringValues(values.got, values.want, diffLimits)

  return { kind: "aligned", rows: formatNonStringRows(values) }
}
