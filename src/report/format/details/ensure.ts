import { diffArrays } from "diff"

import type { AlignedRow } from "#report/format/details/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/aligned-row.ts"
import type { DetailRows } from "#report/format/details/details.ts"
import type { DiffLimits } from "#report/format/details/diff.ts"
import { FULL_DIFF_TIMEOUT_MS, LINE_LIMIT_FLAG, TIME_LIMIT_FLAG } from "#report/format/details/diff.ts"
import { gotValueElement, noteElement, wantValueElement } from "#report/format/elements/elements.ts"
import type { EnsureComparisonValues } from "#session/session.ts"
import { splitLines } from "#utils.ts"

/**
 * Formats the note in place of values that took too long to compare, naming the flag that shows them only when one
 * does.
 */
const formatSlowCompareNote = (hasTimeLimit: boolean): string =>
  noteElement(`values took too long to compare${hasTimeLimit ? `, run with ${TIME_LIMIT_FLAG} to see them` : ""}`)

/** Formats the note in place of `lineCount` differing lines, which are too many to show. */
const formatManyLinesNote = (lineCount: number): string =>
  noteElement(`${lineCount} lines differ, run with ${LINE_LIMIT_FLAG} to see them`)

/** Formats the note in place of `itemCount` differing items of a list, which are too many to show. */
const formatManyItemsNote = (itemCount: number): string =>
  noteElement(`${itemCount} items differ, run with ${LINE_LIMIT_FLAG} to see them`)

type BooleanWantValues = Extract<EnsureComparisonValues, { kind: "exit" | "boolean" }>
type ListValues = Extract<EnsureComparisonValues, { kind: "list" }>

// Describe an exit code in words, because a bare `1` would be hard to read.
const describeExitCode = (exitCode: number) => `exit code ${exitCode}`
const describeWantedExit = (wantsZero: boolean) => (wantsZero ? "exit code 0" : "a non-zero exit code")

/** Formats the `got` and `want` rows of a boolean `want`: a command's exit code, or a check function's boolean. */
const formatBooleanWantRows = (values: BooleanWantValues): AlignedRow[] => {
  const got = values.kind === "exit" ? gotValueElement(values.got, describeExitCode) : gotValueElement(values.got)
  const want =
    values.kind === "exit" ? wantValueElement(values.want, describeWantedExit) : wantValueElement(values.want)
  return [formatAlignedRow("got", [got]), formatAlignedRow("want", [want])]
}

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

/**
 * Formats a list's `missing:` and `extra:` rows, `missing` first, because what the script wants is what a reader checks
 * first. Shows a row only for a side that has items. More items than `diffLimits` allows become a note.
 */
const formatListValues = ({ missing, extra }: ListValues, diffLimits: DiffLimits): DetailRows => {
  const itemCount = missing.length + extra.length
  if (diffLimits.maxLines !== undefined && itemCount > diffLimits.maxLines)
    return { kind: "unaligned", rows: [formatManyItemsNote(itemCount)] }

  const missingRows =
    missing.length > 0
      ? [
          formatAlignedRow(
            "missing",
            missing.map((item) => wantValueElement(item)),
          ),
        ]
      : []
  const extraRows =
    extra.length > 0
      ? [
          formatAlignedRow(
            "extra",
            extra.map((item) => gotValueElement(item)),
          ),
        ]
      : []
  return { kind: "aligned", rows: [...missingRows, ...extraRows] }
}

/**
 * Formats what an `ensure` compared: `got` and `want` rows, a list's `missing` and `extra` rows, or a note when the
 * lines or items can't show.
 */
export const formatEnsureValues = (values: EnsureComparisonValues, diffLimits: DiffLimits): DetailRows => {
  if (values.kind === "exit" || values.kind === "boolean")
    return { kind: "aligned", rows: formatBooleanWantRows(values) }
  if (values.kind === "string") return formatStringValues(values.got, values.want, diffLimits)
  return formatListValues(values, diffLimits)
}
