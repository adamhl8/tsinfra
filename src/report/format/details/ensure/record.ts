import { deepEquals } from "bun"

import type {
  RecordComparisonValues,
  RecordValue,
  RecordWant,
} from "#core/session/handlers/ensure/comparison/record.ts"
import type { DetailRows } from "#report/format/details.ts"
import type { DiffLimits } from "#report/format/details/diff/limits.ts"
import { LINE_LIMIT_FLAG } from "#report/format/details/diff/limits.ts"
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

/** Returns the keys either record has, `want`'s in its order, then the ones only `got` has, in its order. */
const getKeys = (got: RecordWant | undefined, want: RecordWant | undefined): string[] => [
  ...new Set([...Object.keys(want ?? {}), ...Object.keys(got ?? {})]),
]

/** Returns the value `record` has at `key`, or nothing when it doesn't have the key. */
const getOwnValue = (record: RecordWant | undefined, key: string): RecordValue | undefined =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined

/**
 * Formats a row per key whose values differ, from the host's value to the wanted one, with `(none)` for a side without
 * the key. A key that holds a record on both sides, or on one side with the other side absent, gets a heading with its
 * own rows under it. Two kinds of value at one key, like a string and a record, show on one row.
 */
const formatRecordRows = (got: RecordWant | undefined, want: RecordWant | undefined): AlignedRow[] =>
  getKeys(got, want).flatMap((key) => {
    const gotValue = getOwnValue(got, key)
    const wantValue = getOwnValue(want, key)
    if (deepEquals(gotValue, wantValue)) return []

    if (isRecordOrAbsent(gotValue) && isRecordOrAbsent(wantValue)) {
      const nestedRows = formatRecordRows(gotValue, wantValue)
      // Show an empty record against an absent side on one row, because it has no rows to nest.
      if (nestedRows.length > 0) return [formatKeyHeadingRow(key, nestedRows)]
    }

    return [formatKeyRow(key, [changeElement(gotValue, wantValue)])]
  })

/**
 * Formats a record's rows, one per key that differs, from the host's value to the wanted one, with `(none)` for a side
 * without the key, and the keys of a nested record under a heading. Shows the keys in `want`'s order, then the extra
 * ones in the check's order. More lines than `diffLimits` allows become a note that counts the top-level keys.
 */
export const formatRecordValues = ({ got, want }: RecordComparisonValues, diffLimits: DiffLimits): DetailRows => {
  const rows = formatRecordRows(got, want)

  if (diffLimits.maxLines !== undefined && countRowLines(rows) > diffLimits.maxLines)
    return { kind: "unaligned", rows: [formatManyKeysNote(rows.length)] }

  return { kind: "aligned", rows }
}
