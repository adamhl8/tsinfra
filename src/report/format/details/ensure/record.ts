import { deepEqual } from "fast-equals"

import type {
  RecordComparisonValues,
  RecordPrimitive,
  RecordValue,
  RecordWant,
} from "#core/session/handlers/ensure/comparison/record.ts"
import { isRecordList, isRecordSet } from "#core/session/handlers/ensure/comparison/record/nested-kinds.ts"
import { toSetDifference } from "#core/session/handlers/ensure/comparison/set.ts"
import type { DetailRows } from "#report/format/details.ts"
import type { DiffLimits } from "#report/format/details/diff/limits.ts"
import { LINE_LIMIT_FLAG, isPastLineLimit } from "#report/format/details/diff/limits.ts"
import { formatNestedListDiff } from "#report/format/details/diff/list.ts"
import { formatSetRows } from "#report/format/details/ensure/set.ts"
import type { AlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { countRowLines, formatKeyHeadingRow, formatKeyRow } from "#report/format/details/shared/aligned-row.ts"
import { noteElement } from "#report/format/elements/messages.ts"
import { changeElement } from "#report/format/elements/values.ts"
import { countOf, isPlainObject } from "#utils.ts"

/** Formats the note in place of `keyCount` differing keys of a record, which are too many to show. */
const formatManyKeysNote = (keyCount: number): string =>
  noteElement(`${countOf(keyCount, "key differs", "keys differ")}, run with ${LINE_LIMIT_FLAG} to see them`)

/** Checks whether a side of a key holds a record or lacks the key, so its rows can nest under the key. */
const isRecordOrAbsent = (value: RecordValue | undefined): value is RecordWant | undefined =>
  value === undefined || isPlainObject(value)

/** Checks whether a side of a key holds a list or lacks the key, so its diff can nest under the key. */
const isListOrAbsent = (value: RecordValue | undefined): value is readonly RecordValue[] | undefined =>
  value === undefined || isRecordList(value)

/** Checks whether a side of a key holds a set or lacks the key, so its rows can nest under the key. */
const isSetOrAbsent = (value: RecordValue | undefined): value is ReadonlySet<RecordPrimitive> | undefined =>
  value === undefined || isRecordSet(value)

/** Returns the keys either record has, `want`'s in its order, then the ones only `got` has, in its order. */
const getKeys = (got: RecordWant | undefined, want: RecordWant | undefined): string[] => [
  ...new Set([...Object.keys(want ?? {}), ...Object.keys(got ?? {})]),
]

/** Returns the value `record` has at `key`, or nothing when it doesn't have the key. */
const getOwnValue = (record: RecordWant | undefined, key: string): RecordValue | undefined =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined

/**
 * Formats a row per key whose values differ, from the host's value to the wanted one, with `(none)` for a side without
 * the key. A key that holds a record, a list, or a set on both sides, or on one side with the other side absent, gets a
 * heading with its rows or diff under it. Two kinds of value at one key, like a string and a record, show on one row.
 */
const formatRecordRows = (
  got: RecordWant | undefined,
  want: RecordWant | undefined,
  diffLimits: DiffLimits,
): AlignedRow[] =>
  getKeys(got, want).flatMap((key) => {
    const gotValue = getOwnValue(got, key)
    const wantValue = getOwnValue(want, key)
    if (deepEqual(gotValue, wantValue)) return []

    // oxlint-disable-next-line no-use-before-define - a nested record's rows are a record's rows
    const nestedRows = formatNestedRows(gotValue, wantValue, diffLimits)
    if (nestedRows) return [formatKeyHeadingRow(key, nestedRows)]
    return [formatKeyRow(key, [changeElement(gotValue, wantValue)])]
  })

/**
 * Formats the rows nested under a key whose two sides differ: a nested record's rows, a nested list's diff, or a nested
 * set's `missing:` and `extra:` rows. A side without the key counts as an empty one of the other side's kind. Returns
 * nothing for two kinds of value, or for a side with nothing to nest, like an empty record against an absent side, so
 * the key shows on one row.
 */
const formatNestedRows = (
  gotValue: RecordValue | undefined,
  wantValue: RecordValue | undefined,
  diffLimits: DiffLimits,
): DetailRows | undefined => {
  if (isRecordOrAbsent(gotValue) && isRecordOrAbsent(wantValue)) {
    const recordRows = formatRecordRows(gotValue, wantValue, diffLimits)
    return recordRows.length > 0 ? { kind: "aligned", rows: recordRows } : undefined
  }

  if (isListOrAbsent(gotValue) && isListOrAbsent(wantValue)) {
    const diffLines = formatNestedListDiff(gotValue ?? [], wantValue ?? [], diffLimits)
    return diffLines.length > 0 ? { kind: "unaligned", rows: diffLines } : undefined
  }

  if (isSetOrAbsent(gotValue) && isSetOrAbsent(wantValue)) {
    const { missing, extra } = toSetDifference(
      gotValue ?? new Set<RecordPrimitive>(),
      wantValue ?? new Set<RecordPrimitive>(),
    )
    const setRows = formatSetRows(missing, extra)
    return setRows.length > 0 ? { kind: "aligned", rows: setRows } : undefined
  }

  return undefined
}

/**
 * Formats a record's rows, one per key that differs, from the host's value to the wanted one, with `(none)` for a side
 * without the key, and the keys of a nested record, the diff of a nested list, and the items of a nested set under a
 * heading. Shows the keys in `want`'s order, then the extra ones in the check's order. More lines than `diffLimits`
 * allows become a note that counts the top-level keys.
 */
export const formatRecordValues = ({ got, want }: RecordComparisonValues, diffLimits: DiffLimits): DetailRows => {
  const rows = formatRecordRows(got, want, diffLimits)

  if (isPastLineLimit(countRowLines(rows), diffLimits))
    return { kind: "unaligned", rows: [formatManyKeysNote(rows.length)] }

  return { kind: "aligned", rows }
}
