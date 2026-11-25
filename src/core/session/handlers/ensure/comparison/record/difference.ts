import { isDeepEqual, isDefined, isEmpty, mapValues, omit, pickBy } from "remeda"

import type { RecordPrimitive, RecordValue, RecordWant } from "#core/session/handlers/ensure/comparison/record.ts"
import type {
  DifferingMark,
  DifferingRecord,
} from "#core/session/handlers/ensure/comparison/record/difference/differing.ts"
import { markAllKeys, markExtraKeys } from "#core/session/handlers/ensure/comparison/record/difference/differing.ts"
import type {
  NestedExtraEntry,
  NestedExtraKey,
  NestedExtraList,
} from "#core/session/handlers/ensure/comparison/record/difference/nested-extra.ts"
import type { UnmetRecord } from "#core/session/handlers/ensure/comparison/record/difference/unmet.ts"
import { isNestedRecord, isNestedSet } from "#core/session/handlers/ensure/comparison/record/nested-kinds.ts"
import type { Simplify, WithoutNeverKeys } from "#core/session/handlers/ensure/comparison/record/utils.ts"
import { toSetDifference } from "#core/session/handlers/ensure/comparison/set.ts"
import { getOwnValue } from "#utils.ts"

/**
 * What a record's fix gets: the two records, and how they differ at any depth. Takes `want`'s type, and its default is
 * the shape the comparison builds.
 */
export type RecordDifference<T = RecordWant> = Simplify<
  WithoutNeverKeys<{
    /** The record the check returned. */
    got: T
    /** The record the step wants. */
    want: T
    /**
     * What `want` has that the host doesn't match, at any depth. A nested record keeps only the keys that differ, a
     * nested set only its missing items, and any other value stays whole. A fix that writes a value whole takes it from
     * `want`.
     */
    unmet: UnmetRecord<T>
    /** The top-level keys the host has that `want` doesn't, with the host's values. */
    extra: Record<string, RecordValueIn<T>>
    /** What the host has inside the values `want` keeps: a key in a nested record, or a nested set's extra items. */
    nestedExtra: NestedExtraList<T>
    /**
     * Each path where the host differs from `want`, marked `true`, with a nested record holding only its keys that lead
     * to a mark. A fix that writes whole values at some depth rewrites each key marked there from `want`.
     */
    differing: DifferingRecord<T>
  }>
>

// Distribute over `T`, so a union of records gives each one's values.
// Leave out `undefined`, which an optional key adds, because validation refuses it as a value.
export type RecordValueIn<T> = T extends unknown ? Exclude<T[keyof T], undefined> : never

/** A record value that isn't a nested record, with items of any type, so a list or a set `want` types matches too. */
export type NonRecordValue = RecordPrimitive | readonly unknown[] | ReadonlySet<unknown>

/** The path to a value inside a record, from its top-level key. */
type ValuePath = readonly [string, ...string[]]

/**
 * How one wanted value differs from the host's: the part of it that's unmet, if any, the extras inside it, and its
 * mark, if anything differs.
 */
interface ValueDifference {
  unmet: RecordValue | undefined
  nestedExtra: NestedExtraEntry[]
  differing: DifferingMark<RecordValue> | undefined
}

/** How the keys a record `want` has differ from the host's record, leaving out the keys only the host has. */
interface WantedKeysDifference {
  unmet: RecordWant
  nestedExtra: NestedExtraEntry[]
  differing: DifferingRecord<RecordWant>
}

/** Compares two nested sets: the missing items are unmet, and the host's other items are one entry of extras. */
const toNestedSetDifference = (
  got: ReadonlySet<RecordPrimitive>,
  want: ReadonlySet<RecordPrimitive>,
  path: ValuePath,
): ValueDifference => {
  const { missing, extra } = toSetDifference(got, want)
  const unmet = missing.length > 0 ? new Set(missing) : undefined
  const nestedExtra: NestedExtraEntry[] = extra.length > 0 ? [{ kind: "items", path, value: extra }] : []
  const hasDifference = missing.length > 0 || extra.length > 0
  const differing = hasDifference ? true : undefined
  return { unmet, nestedExtra, differing }
}

/**
 * Compares two nested records by key. The keys that differ are unmet, and the host's other keys are extras, after the
 * extras inside the wanted keys. Both kinds of key are marked, the wanted ones first.
 */
const toNestedRecordDifference = (got: RecordWant, want: RecordWant, path: ValuePath): ValueDifference => {
  // oxlint-disable-next-line no-use-before-define - a nested record's keys compare like a record's
  const wantedKeysDifference = toWantedKeysDifference(got, want, path)
  const extra = omit(got, Object.keys(want))
  const extraKeys = Object.entries(extra).map(([key, value]): NestedExtraKey => ({
    kind: "key",
    path: [...path, key],
    value,
  }))
  const allDiffering = { ...wantedKeysDifference.differing, ...markExtraKeys(extra) }

  const unmet = isEmpty(wantedKeysDifference.unmet) ? undefined : wantedKeysDifference.unmet
  const differing = isEmpty(allDiffering) ? undefined : allDiffering
  return { unmet, nestedExtra: [...wantedKeysDifference.nestedExtra, ...extraKeys], differing }
}

/**
 * Compares a wanted value with the host's. Two records or two sets compare inside, and any other value is unmet whole
 * unless it's equal, including a value of another kind than the host's, or one the host doesn't have. Such a value is
 * marked `true`, except a wanted record, which marks all its keys.
 */
const toValueDifference = (
  gotValue: RecordValue | undefined,
  wantValue: RecordValue,
  path: ValuePath,
): ValueDifference => {
  if (isNestedRecord(gotValue) && isNestedRecord(wantValue)) return toNestedRecordDifference(gotValue, wantValue, path)
  if (isNestedSet(gotValue) && isNestedSet(wantValue)) return toNestedSetDifference(gotValue, wantValue, path)
  if (isDeepEqual(gotValue, wantValue)) return { unmet: undefined, nestedExtra: [], differing: undefined }

  const differing = isNestedRecord(wantValue) ? markAllKeys(wantValue) : true
  return { unmet: wantValue, nestedExtra: [], differing }
}

/** Compares each key `want` has with the host's value there, keeping `want`'s key order. */
const toWantedKeysDifference = (
  got: RecordWant,
  want: RecordWant,
  path: readonly [] | ValuePath,
): WantedKeysDifference => {
  const valueDifferences = mapValues(want, (wantValue, key) =>
    toValueDifference(getOwnValue(got, key), wantValue, [...path, key]),
  )
  const unmetByKey = mapValues(valueDifferences, (valueDifference) => valueDifference.unmet)
  const unmet = pickBy(unmetByKey, isDefined)
  const nestedExtra = Object.values(valueDifferences).flatMap((valueDifference) => valueDifference.nestedExtra)
  const differingByKey = mapValues(valueDifferences, (valueDifference) => valueDifference.differing)
  const differing = pickBy(differingByKey, isDefined)
  return { unmet, nestedExtra, differing }
}

/**
 * Compares two records at every depth, with each value compared exactly, so `-0` matches `0` and key order doesn't
 * count. `unmet` holds what `want` has that the host doesn't match, in `want`'s key order:
 *
 * - A nested record keeps only the keys that differ.
 * - A nested set keeps only its missing items.
 * - Any other value stays whole, and so does a value of another kind than the host's, or one the host doesn't have.
 *
 * `extra` and `nestedExtra` keep the host's order inside each record and set, and `nestedExtra` follows `want`'s keys.
 * `differing` marks every path where something differs, with each record's wanted keys before the host's own.
 */
export const toRecordDifference = (got: RecordWant, want: RecordWant): RecordDifference => {
  const wantedKeysDifference = toWantedKeysDifference(got, want, [])
  const { unmet, nestedExtra } = wantedKeysDifference
  const extra = omit(got, Object.keys(want))
  const differing = { ...wantedKeysDifference.differing, ...markExtraKeys(extra) }
  return { got, want, unmet, extra, nestedExtra, differing }
}
