import { diffArrays } from "diff"

import type { DetailRows } from "#report/format/details.ts"
import type { DiffLimits } from "#report/format/details/diff/limits.ts"
import {
  FULL_DIFF_TIMEOUT_MS,
  LINE_LIMIT_FLAG,
  TIME_LIMIT_FLAG,
  isPastLineLimit,
} from "#report/format/details/diff/limits.ts"
import type { AlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { noteElement } from "#report/format/elements/messages.ts"
import { gotValueElement, wantValueElement } from "#report/format/elements/values.ts"
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
export const formatStringValues = (got: string, want: string, diffLimits: DiffLimits): DetailRows => {
  const timeout = diffLimits.timeoutMs ?? FULL_DIFF_TIMEOUT_MS
  const changes = diffArrays(splitLines(got), splitLines(want), { timeout })

  if (changes === undefined)
    return { kind: "unaligned", rows: [formatSlowCompareNote(diffLimits.timeoutMs !== undefined)] }

  const gotLines = changes.filter((change) => change.removed).flatMap((change) => change.value)
  const wantLines = changes.filter((change) => change.added).flatMap((change) => change.value)
  const lineCount = gotLines.length + wantLines.length
  if (isPastLineLimit(lineCount, diffLimits)) return { kind: "unaligned", rows: [formatManyLinesNote(lineCount)] }

  const rows = [
    ...toSideRows("got", got, gotLines, gotValueElement),
    ...toSideRows("want", want, wantLines, wantValueElement),
  ]
  return { kind: "aligned", rows }
}
