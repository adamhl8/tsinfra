import { scope, type } from "arktype"
import { deepEquals } from "bun"

import type { Comparison } from "#core/session/handlers/shared/converge.ts"
import { isPlainObject } from "#utils.ts"

/** A value a record `want` holds at a key: a string, a number, a boolean, `null`, or a nested record of them. */
export type RecordValue = string | number | boolean | null | RecordWant

/** A record `want` as a script passes it, readonly so a constant or `as const` works, which the schema can't express. */
export interface RecordWant {
  readonly [key: string]: RecordValue
}

// Refuse any other object at every depth, like a `Map` or a `Promise`, because an index signature takes it by its own
// keys, usually none.
const recordSchemas = scope({
  value: "string | number | boolean | null | record",
  record: [{ "[string]": "value" }, ":", (record, ctx) => isPlainObject(record) || ctx.mustBe("a plain object")],
}).export()

/**
 * Returns the path to the first value in `record` that's one of the records holding it, or nothing when there's none. A
 * record that appears at two keys without holding itself is fine.
 */
const findSelfReference = (record: RecordWant, ancestors: ReadonlySet<RecordWant>): string[] | undefined => {
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "object" || value === null) continue
    if (ancestors.has(value)) return [key]

    const path = findSelfReference(value, new Set([...ancestors, value]))
    if (path) return [key, ...path]
  }
  return undefined
}

/**
 * A record `want`, a plain object of string keys and `RecordValue`s, which a function's object must match by key.
 * Refuses a record that holds itself, because masking it and showing it would never end.
 */
export const recordWantSchema = type(recordSchemas.record)
  .narrow((record, ctx) => {
    const path = findSelfReference(record, new Set([record]))
    if (!path) return true
    return ctx.reject({
      path: [...ctx.path, ...path],
      expected: "a value of its own",
      actual: "a record that holds it",
    })
  })
  .as<RecordWant>()

/** A record of `V` values, `RecordValue`s by default. */
type ValueRecord<V extends RecordValue = RecordValue> = Record<string, V>

/**
 * What a record's fix gets: how the record the check gave differs from the one it wanted, by key. `missing` maps a key
 * the host doesn't have to its wanted value, and `changed` maps a key both have to its two values, because the pairing
 * is the difference. `unmet` maps every key that's `missing` or `changed` to its wanted value, in `want`'s key order,
 * which repeats the two for a fix that sets every wanted value. `extra` maps a key `want` doesn't have to its current
 * value.
 */
export interface RecordDifference<V extends RecordValue = RecordValue> {
  missing: ValueRecord<V>
  changed: Record<string, { got: V; want: V }>
  unmet: ValueRecord<V>
  extra: ValueRecord<V>
}

/**
 * A record the check gave and the one it wanted, and how they differ. It leaves out `unmet`, because only the fix needs
 * it.
 */
export interface RecordComparisonValues extends Omit<RecordDifference, "unmet"> {
  kind: "record"
  got: ValueRecord
  want: ValueRecord
}

/** Returns the entries of `record` whose keys `others` doesn't have, in `record`'s key order. */
const getEntriesNotIn = (record: RecordWant, others: RecordWant): ValueRecord =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !Object.hasOwn(others, key)))

/** Returns the entries of `want` whose keys are `missing` or `changed`, in `want`'s key order. */
export const toUnmet = (values: RecordComparisonValues): ValueRecord => {
  const { want, missing, changed } = values
  return Object.fromEntries(
    Object.entries(want).filter(([key]) => Object.hasOwn(missing, key) || Object.hasOwn(changed, key)),
  )
}

/** Returns a copy of `value` at every depth, with each `-0` as `0`. */
const toNormalizedValue = (value: RecordValue): RecordValue => {
  if (typeof value === "number") return value === 0 ? 0 : value
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toNormalizedValue(item)]))
}

/**
 * Returns a copy of `record` at every depth, with each `-0` as `0`. Turn `-0` into `0`, because `deepEquals` tells them
 * apart, and the report would show both as `0`.
 */
const toNormalizedRecord = (record: RecordWant): ValueRecord =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [key, toNormalizedValue(value)]))

/**
 * Compares two records by key, with each value compared exactly and nested records compared the same way, so key order
 * doesn't count at any depth. `missing` and `changed` keep `want`'s key order, and `extra` keeps the check's. Each
 * holds a top-level key's whole value.
 */
export const compareRecords = (gotRecord: RecordWant, wantRecord: RecordWant): Comparison => {
  // Copy both, so a script that changes its own records after the step can't change what was recorded.
  const got = toNormalizedRecord(gotRecord)
  const want = toNormalizedRecord(wantRecord)

  const missing = getEntriesNotIn(want, got)
  const changed = Object.fromEntries(
    Object.entries(want).flatMap(([key, wantValue]) => {
      const gotValue = got[key]
      const isChanged = Object.hasOwn(got, key) && gotValue !== undefined && !deepEquals(gotValue, wantValue)
      return isChanged ? [[key, { got: gotValue, want: wantValue }]] : []
    }),
  )
  const extra = getEntriesNotIn(got, want)

  const values: RecordComparisonValues = { kind: "record", got, want, missing, changed, extra }
  const inSync = [missing, changed, extra].every((part) => Object.keys(part).length === 0)
  return { inSync, values }
}
