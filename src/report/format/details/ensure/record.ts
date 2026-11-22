import type {
  RecordComparisonValues,
  RecordPrimitive,
  RecordValue,
  RecordWant,
} from "#core/session/handlers/ensure/comparison/record.ts"
import type { NestedExtraEntry } from "#core/session/handlers/ensure/comparison/record/difference.ts"
import {
  isNestedList,
  isNestedRecord,
  isNestedSet,
} from "#core/session/handlers/ensure/comparison/record/nested-kinds.ts"
import type { DetailRows } from "#report/format/details.ts"
import type { DiffLimits } from "#report/format/details/diff/limits.ts"
import { LINE_LIMIT_FLAG, isPastLineLimit } from "#report/format/details/diff/limits.ts"
import { formatNestedListDiff } from "#report/format/details/diff/list.ts"
import { formatSetRows } from "#report/format/details/ensure/set.ts"
import type { AlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { countRowLines, formatKeyHeadingRow, formatKeyRow } from "#report/format/details/shared/aligned-row.ts"
import { noteElement } from "#report/format/elements/asides.ts"
import { changeElement } from "#report/format/elements/values.ts"
import { countOf, getOwnValue } from "#utils.ts"

/** Formats the note in place of `keyCount` differing keys of a record, which are too many to show. */
const formatManyKeysNote = (keyCount: number): string =>
  noteElement(`${countOf(keyCount, "key differs", "keys differ")}, run with ${LINE_LIMIT_FLAG} to see them`)

/** Checks whether a side of a key holds a record or lacks the key, so its rows can nest under the key. */
const isRecordOrAbsent = (value: RecordValue | undefined): value is RecordWant | undefined =>
  value === undefined || isNestedRecord(value)

/** Checks whether a side of a key holds a list or lacks the key, so its diff can nest under the key. */
const isListOrAbsent = (value: RecordValue | undefined): value is readonly RecordValue[] | undefined =>
  value === undefined || isNestedList(value)

/** Checks whether a side of a key holds a set or lacks the key, so its rows can nest under the key. */
const isSetOrAbsent = (value: RecordValue | undefined): value is ReadonlySet<RecordPrimitive> | undefined =>
  value === undefined || isNestedSet(value)

type ItemsEntry = Extract<NestedExtraEntry, { kind: "items" }>

/**
 * A record's recorded difference at one level, like `RecordComparisonValues` at the top, with either side absent below
 * it: a key only the host has has no `want`, and a key it doesn't have has no `got`.
 */
interface RecordLevel {
  got: RecordWant | undefined
  want: RecordWant | undefined
  unmet: RecordWant | undefined
  extra: RecordWant
  /** The `nestedExtra` entries under this level. */
  nestedExtra: readonly NestedExtraEntry[]
}

/** One key of a level, with its two sides, what's unmet there, and the `nestedExtra` entries under it. */
interface KeyDifference {
  gotValue: RecordValue | undefined
  wantValue: RecordValue | undefined
  unmetValue: RecordValue | undefined
  nestedExtra: readonly NestedExtraEntry[]
}

/**
 * Returns the keys a level shows: each of `want`'s that's unmet or holds an extra, in `want`'s order, then the extra
 * keys, in the host's order. `depth` is where an entry's path names this level's keys.
 */
const getShownKeys = (level: RecordLevel, depth: number): string[] => {
  const { want, unmet, extra, nestedExtra } = level
  const wantedKeys = Object.keys(want ?? {}).filter(
    (key) => getOwnValue(unmet, key) !== undefined || nestedExtra.some(({ path }) => path[depth] === key),
  )
  return [...wantedKeys, ...Object.keys(extra)]
}

/** Returns a key's sides from its level, with what's unmet there and the entries under it. */
const toKeyDifference = (level: RecordLevel, key: string, depth: number): KeyDifference => ({
  gotValue: getOwnValue(level.got, key),
  wantValue: getOwnValue(level.want, key),
  unmetValue: getOwnValue(level.unmet, key),
  nestedExtra: level.nestedExtra.filter(({ path }) => path[depth] === key),
})

/** Returns a nested level's extra keys with the host's values, from the key entries whose path ends at `depth`. */
const toNestedExtra = (nestedExtra: readonly NestedExtraEntry[], depth: number): RecordWant =>
  Object.fromEntries(
    nestedExtra.flatMap((entry): [string, RecordValue][] => {
      const key = entry.path[depth]
      const endsHere = entry.kind === "key" && key !== undefined && entry.path.length === depth + 1
      return endsHere ? [[key, entry.value]] : []
    }),
  )

/**
 * Formats a row per key the recorded difference holds at a level, from the host's value to the wanted one, with
 * `(none)` for a side without the key. A key that holds a record, a list, or a set on both sides, or on one side with
 * the other side absent, gets a heading with its rows or diff under it. Two kinds of value at one key, like a string
 * and a record, show on one row. `depth` is where an entry's path names this level's keys.
 */
const formatRecordRows = (level: RecordLevel, depth: number, diffLimits: DiffLimits): AlignedRow[] =>
  getShownKeys(level, depth).map((key) => {
    const keyDifference = toKeyDifference(level, key, depth)
    // oxlint-disable-next-line no-use-before-define - a nested record's rows are a record's rows
    const nestedRows = formatNestedRows(keyDifference, depth + 1, diffLimits)
    if (nestedRows) return formatKeyHeadingRow(key, nestedRows)
    return formatKeyRow(key, [changeElement(keyDifference.gotValue, keyDifference.wantValue)])
  })

/**
 * Formats the rows nested under a key: a nested record's rows, a nested list's diff, or a nested set's `missing:` and
 * `extra:` rows. A side without the key counts as an empty one of the other side's kind, so a key only the host has
 * shows its whole value as extra. Returns nothing for two kinds of value, or for a side with nothing to nest, like an
 * empty record against an absent side, so the key shows on one row. `depth` is the nested level's.
 */
const formatNestedRows = (
  keyDifference: KeyDifference,
  depth: number,
  diffLimits: DiffLimits,
): DetailRows | undefined => {
  const { gotValue, wantValue, unmetValue, nestedExtra } = keyDifference

  if (isRecordOrAbsent(gotValue) && isRecordOrAbsent(wantValue)) {
    const unmet = isRecordOrAbsent(unmetValue) ? unmetValue : undefined
    const extra = wantValue === undefined ? (gotValue ?? {}) : toNestedExtra(nestedExtra, depth)
    const recordRows = formatRecordRows(
      { got: gotValue, want: wantValue, unmet, extra, nestedExtra },
      depth,
      diffLimits,
    )
    return recordRows.length > 0 ? { kind: "aligned", rows: recordRows } : undefined
  }

  if (isListOrAbsent(gotValue) && isListOrAbsent(wantValue)) {
    const diffLines = formatNestedListDiff(gotValue ?? [], wantValue ?? [], diffLimits)
    return diffLines.length > 0 ? { kind: "unaligned", rows: diffLines } : undefined
  }

  if (isSetOrAbsent(gotValue) && isSetOrAbsent(wantValue)) {
    const missing = isNestedSet(unmetValue) ? [...unmetValue] : []
    // Find the set's own entry, whose path ends at the key that holds it.
    const itemsEntry = nestedExtra.find(
      (entry): entry is ItemsEntry => entry.kind === "items" && entry.path.length === depth,
    )
    const extra = wantValue === undefined ? [...(gotValue ?? [])] : (itemsEntry?.value ?? [])
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
export const formatRecordValues = (values: RecordComparisonValues, diffLimits: DiffLimits): DetailRows => {
  const rows = formatRecordRows(values, 0, diffLimits)

  if (isPastLineLimit(countRowLines(rows), diffLimits))
    return { kind: "unaligned", rows: [formatManyKeysNote(rows.length)] }

  return { kind: "aligned", rows }
}
