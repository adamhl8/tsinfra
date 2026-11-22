import { deepEqual } from "fast-equals"

import type { RecordPrimitive, RecordValue, RecordWant } from "#core/session/handlers/ensure/comparison/record.ts"
import type { NestedExtraList } from "#core/session/handlers/ensure/comparison/record/difference/nested-extra.ts"
import type { UnmetRecord } from "#core/session/handlers/ensure/comparison/record/difference/unmet.ts"
import { isNestedRecord, isNestedSet } from "#core/session/handlers/ensure/comparison/record/nested-kinds.ts"
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
  }>
>

// Leave out a key whose type is `never`, like `nestedExtra` for a `want` that can't nest a record or a set.
// Map one object literal rather than intersect two, because an intersection's keys can show in any order in a hover.
type WithoutNeverKeys<T> = { [K in keyof T as IsNever<T[K]> extends true ? never : K]: T[K] }

/** A key the host has in a nested record that `want` doesn't. */
export interface NestedExtraKey<V = RecordValue> {
  /** Marks a key in a nested record, as opposed to a nested set's items. */
  kind: "key"
  /** The keys from the top-level key down to the extra one, like `["env", "DEBUG"]`. */
  path: readonly [string, ...string[], string]
  /** The host's value at `path`. */
  value: V
}

/** The items the host has in a nested set that `want` doesn't. */
export interface NestedExtraItems<I = RecordPrimitive> {
  /** Marks a nested set's items, as opposed to a key in a nested record. */
  kind: "items"
  /** The keys from the top-level key down to the set, like `["packages"]`. */
  path: readonly [string, ...string[]]
  /** The items the host's set has that `want`'s doesn't, in the host's order. */
  value: I[]
}

// Distribute over `T`, so a union of records gives each one's values.
// Leave out `undefined`, which an optional key adds, because validation refuses it as a value.
export type RecordValueIn<T> = T extends unknown ? Exclude<T[keyof T], undefined> : never

/** A record value that isn't a nested record, with items of any type, so a list or a set `want` types matches too. */
export type NonRecordValue = RecordPrimitive | readonly unknown[] | ReadonlySet<unknown>

// Wrap `T` in a tuple, because a bare `T extends never` gives `never` for `never` instead of `true`.
export type IsNever<T> = [T] extends [never] ? true : false

// Flatten an intersection into one object type, so a hover shows its keys.
// Intersect with `{}`, because a hover otherwise shows `Simplify<...>` around the intersection.
// oxlint-disable-next-line typescript/ban-types - the `{}` is what makes a hover show the flattened type
export type Simplify<T> = { [K in keyof T]: T[K] } & {}

/** A `nestedExtra` entry for any record, as the comparison builds it and the report reads it. */
export type NestedExtraEntry = NestedExtraKey | NestedExtraItems

/** The path to a value inside a record, from its top-level key. */
type ValuePath = readonly [string, ...string[]]

/** How one wanted value differs from the host's: the part of it that's unmet, if any, and the extras inside it. */
interface ValueDifference {
  unmet: RecordValue | undefined
  nestedExtra: NestedExtraEntry[]
}

/** How the keys a record `want` has differ from the host's record, leaving out the keys only the host has. */
interface WantedKeysDifference {
  unmet: RecordWant
  nestedExtra: NestedExtraEntry[]
}

/** Returns the entries of `record` whose keys `others` doesn't have, in `record`'s key order. */
const getEntriesNotIn = (record: RecordWant, others: RecordWant): RecordWant =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !Object.hasOwn(others, key)))

/** Compares two nested sets: the missing items are unmet, and the host's other items are one entry of extras. */
const toNestedSetDifference = (
  got: ReadonlySet<RecordPrimitive>,
  want: ReadonlySet<RecordPrimitive>,
  path: ValuePath,
): ValueDifference => {
  const { missing, extra } = toSetDifference(got, want)
  const unmet = missing.length > 0 ? new Set(missing) : undefined
  const nestedExtra: NestedExtraEntry[] = extra.length > 0 ? [{ kind: "items", path, value: extra }] : []
  return { unmet, nestedExtra }
}

/**
 * Compares two nested records by key. The keys that differ are unmet, and the host's other keys are extras, after the
 * extras inside the wanted keys.
 */
const toNestedRecordDifference = (got: RecordWant, want: RecordWant, path: ValuePath): ValueDifference => {
  // oxlint-disable-next-line no-use-before-define - a nested record's keys compare like a record's
  const wantedKeysDifference = toWantedKeysDifference(got, want, path)
  const extraKeys = Object.entries(getEntriesNotIn(got, want)).map(([key, value]): NestedExtraKey => ({
    kind: "key",
    path: [...path, key],
    value,
  }))

  const hasUnmet = Object.keys(wantedKeysDifference.unmet).length > 0
  const unmet = hasUnmet ? wantedKeysDifference.unmet : undefined
  return { unmet, nestedExtra: [...wantedKeysDifference.nestedExtra, ...extraKeys] }
}

/**
 * Compares a wanted value with the host's. Two records or two sets compare inside, and any other value is unmet whole
 * unless it's equal, including a value of another kind than the host's, or one the host doesn't have.
 */
const toValueDifference = (
  gotValue: RecordValue | undefined,
  wantValue: RecordValue,
  path: ValuePath,
): ValueDifference => {
  if (isNestedRecord(gotValue) && isNestedRecord(wantValue)) return toNestedRecordDifference(gotValue, wantValue, path)
  if (isNestedSet(gotValue) && isNestedSet(wantValue)) return toNestedSetDifference(gotValue, wantValue, path)

  const unmet = deepEqual(gotValue, wantValue) ? undefined : wantValue
  return { unmet, nestedExtra: [] }
}

/** Compares each key `want` has with the host's value there, keeping `want`'s key order. */
const toWantedKeysDifference = (
  got: RecordWant,
  want: RecordWant,
  path: readonly [] | ValuePath,
): WantedKeysDifference => {
  const valueDifferences = Object.entries(want).map(([key, wantValue]) => {
    const valuePath: ValuePath = [...path, key]
    return { key, difference: toValueDifference(getOwnValue(got, key), wantValue, valuePath) }
  })

  const unmet = Object.fromEntries(
    valueDifferences.flatMap(({ key, difference }): [string, RecordValue][] =>
      difference.unmet === undefined ? [] : [[key, difference.unmet]],
    ),
  )
  const nestedExtra = valueDifferences.flatMap(({ difference }) => difference.nestedExtra)
  return { unmet, nestedExtra }
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
 */
export const toRecordDifference = (got: RecordWant, want: RecordWant): RecordDifference => {
  const { unmet, nestedExtra } = toWantedKeysDifference(got, want, [])
  const extra = getEntriesNotIn(got, want)
  return { got, want, unmet, extra, nestedExtra }
}
