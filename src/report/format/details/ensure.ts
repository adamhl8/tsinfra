import { diffArrays } from "diff"

import type { AlignedRow } from "#report/format/details/aligned-row.ts"
import { formatAlignedRow, formatKeyRow } from "#report/format/details/aligned-row.ts"
import type { DetailRows } from "#report/format/details/details.ts"
import type { DiffLimits } from "#report/format/details/diff.ts"
import { FULL_DIFF_TIMEOUT_MS, LINE_LIMIT_FLAG, TIME_LIMIT_FLAG } from "#report/format/details/diff.ts"
import { changeElement, gotValueElement, noteElement, wantValueElement } from "#report/format/elements/elements.ts"
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
type RecordValues = Extract<EnsureComparisonValues, { kind: "record" }>

/** Formats the note in place of `keyCount` differing keys of a record, which are too many to show. */
const formatManyKeysNote = (keyCount: number): string =>
  noteElement(`${keyCount} keys differ, run with ${LINE_LIMIT_FLAG} to see them`)

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
 * Formats a record's rows, one per key that differs, from the host's value to the wanted one, with `(none)` for a side
 * without the key. Shows the keys in `want`'s order, then the extra ones in the check's order. More keys than
 * `diffLimits` allows become a note.
 */
const formatRecordValues = ({ want, missing, extra, changed }: RecordValues, diffLimits: DiffLimits): DetailRows => {
  const wantRows = Object.keys(want).flatMap((key) => {
    const changedValues = changed[key]
    if (changedValues) return [formatKeyRow(key, [changeElement(changedValues.got, changedValues.want)])]
    return Object.hasOwn(missing, key) ? [formatKeyRow(key, [changeElement(undefined, missing[key])])] : []
  })
  const extraRows = Object.entries(extra).map(([key, value]) => formatKeyRow(key, [changeElement(value, undefined)]))
  const rows = [...wantRows, ...extraRows]

  if (diffLimits.maxLines !== undefined && rows.length > diffLimits.maxLines)
    return { kind: "unaligned", rows: [formatManyKeysNote(rows.length)] }

  return { kind: "aligned", rows }
}

/**
 * Formats what an `ensure` compared: `got` and `want` rows, a list's `missing` and `extra` rows, a record's row per
 * key, or a note when the lines, items, or keys can't show.
 */
export const formatEnsureValues = (values: EnsureComparisonValues, diffLimits: DiffLimits): DetailRows => {
  if (values.kind === "exit" || values.kind === "boolean")
    return { kind: "aligned", rows: formatBooleanWantRows(values) }
  if (values.kind === "string") return formatStringValues(values.got, values.want, diffLimits)
  if (values.kind === "list") return formatListValues(values, diffLimits)
  return formatRecordValues(values, diffLimits)
}
