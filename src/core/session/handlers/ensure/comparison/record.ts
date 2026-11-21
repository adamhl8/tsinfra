import { type } from "arktype"
import { deepEqual } from "fast-equals"

import { findRecordValueProblem } from "#core/session/handlers/ensure/comparison/record/validation.ts"
import type { Comparison } from "#core/session/handlers/shared/converge.ts"
import { isPlainObject } from "#utils.ts"

/**
 * A value a record `want` holds at a key: a `RecordPrimitive`, or a nested list of record values, a nested set of
 * primitives, or a nested record.
 */
export type RecordValue = RecordPrimitive | readonly RecordValue[] | ReadonlySet<RecordPrimitive> | RecordWant

/** A record value that holds no others: a string, a number, a boolean, or `null`. */
export type RecordPrimitive = string | number | boolean | null

/** A record `want` as a script passes it, readonly so a constant or `as const` works. */
export interface RecordWant {
  readonly [key: string]: RecordValue
}

/**
 * A record `want` as its schema types it, with mutable lists, which a `RecordWant` takes. Type the schemas with it,
 * because ArkType 2.2.10's inference never ends on a recursive readonly array. Once ArkType infers one, type the
 * schemas with `RecordWant` and `Want`, and delete this and `SchemaWant`.
 */
export interface SchemaRecordWant {
  [key: string]: SchemaRecordValue
}

type SchemaRecordValue = RecordPrimitive | SchemaRecordValue[] | ReadonlySet<RecordPrimitive> | SchemaRecordWant

/** Checks whether `value` is a nested list, because `Array.isArray` doesn't narrow a readonly array. */
export const isRecordList = (value: RecordValue | undefined): value is readonly RecordValue[] => Array.isArray(value)

/** Checks whether `value` is a nested set, because `instanceof` doesn't narrow a `ReadonlySet`. */
export const isRecordSet = (value: RecordValue | undefined): value is ReadonlySet<RecordPrimitive> =>
  value instanceof Set

/** A record `want`, a plain object of string keys and `RecordValue`s, which a function's object must match by key. */
export const recordWantSchema = type("object")
  .narrow((record, ctx) => {
    // Refuse any other object, like a `Map` or a `Promise`, because it would be compared by its own keys, usually none.
    if (!isPlainObject(record)) return ctx.mustBe("a plain object")

    const problem = findRecordValueProblem(record)
    if (!problem) return true
    return ctx.reject({ path: [...ctx.path, ...problem.path], expected: problem.expected, actual: problem.actual })
  })
  .as<SchemaRecordWant>()

/**
 * What a record's fix gets: how the record the check gave differs from the one it wanted, by key. `missing` maps a key
 * the host doesn't have to its wanted value, and `changed` maps a key both have to its two values, because the pairing
 * is the difference. `unmet` maps every key that's `missing` or `changed` to its wanted value, in `want`'s key order,
 * which repeats the two for a fix that sets every wanted value. `extra` maps a key `want` doesn't have to its current
 * value.
 */
export interface RecordDifference<V extends RecordValue = RecordValue> {
  missing: Record<string, V>
  changed: Record<string, { got: V; want: V }>
  unmet: Record<string, V>
  extra: Record<string, V>
}

/** Returns the entries of `want` whose keys are `missing` or `changed`, in `want`'s key order. */
export const toUnmet = (values: RecordComparisonValues): RecordWant => {
  const { want, missing, changed } = values
  return Object.fromEntries(
    Object.entries(want).filter(([key]) => Object.hasOwn(missing, key) || Object.hasOwn(changed, key)),
  )
}

/**
 * A record the check gave and the one it wanted, and how they differ. It leaves out `unmet`, because only the fix needs
 * it.
 */
export interface RecordComparisonValues extends Omit<RecordDifference, "unmet"> {
  kind: "record"
  got: RecordWant
  want: RecordWant
}

/** Returns the entries of `record` whose keys `others` doesn't have, in `record`'s key order. */
const getEntriesNotIn = (record: RecordWant, others: RecordWant): RecordWant =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !Object.hasOwn(others, key)))

/**
 * Compares two records by key, with each value compared exactly and nested records compared the same way, so key order
 * doesn't count at any depth. Matches `-0` to `0`, because the report shows both as `0`. `missing` and `changed` keep
 * `want`'s key order, and `extra` keeps the check's. Each holds a top-level key's whole value.
 */
export const compareRecords = (gotRecord: RecordWant, wantRecord: RecordWant): Comparison => {
  // Copy both, so a script that changes its own records after the step can't change what was recorded.
  const got = structuredClone(gotRecord)
  const want = structuredClone(wantRecord)

  const missing = getEntriesNotIn(want, got)
  const changed = Object.fromEntries(
    Object.entries(want).flatMap(([key, wantValue]) => {
      const gotValue = got[key]
      const isChanged = Object.hasOwn(got, key) && gotValue !== undefined && !deepEqual(gotValue, wantValue)
      return isChanged ? [[key, { got: gotValue, want: wantValue }]] : []
    }),
  )
  const extra = getEntriesNotIn(got, want)

  const values: RecordComparisonValues = { kind: "record", got, want, missing, changed, extra }
  const inSync = [missing, changed, extra].every((part) => Object.keys(part).length === 0)
  return { inSync, values }
}
