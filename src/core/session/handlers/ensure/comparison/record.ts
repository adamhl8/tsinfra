import { type } from "arktype"

import type { Comparison } from "#core/session/handlers/shared/converge.ts"
import { isPlainObject } from "#utils.ts"

/** A value a record `want` holds at a key: a string, a number, or a boolean, never a nested object or array. */
export type RecordValue = string | number | boolean

/**
 * A record `want`, a plain object of string keys and `RecordValue`s, which a function's object must match by key.
 * Refuses any other object in a narrow, like a `Map` or a `Promise`, because the `Record` type takes it by its own
 * keys, usually none.
 */
export const recordWantSchema = type("Record<string, string | number | boolean>").narrow(
  (record, ctx) => isPlainObject(record) || ctx.mustBe("a plain object"),
)

/** A record of `V` values, `RecordValue`s by default. */
type ValueRecord<V extends RecordValue = RecordValue> = Record<string, V>

/** A record `want` as a script passes it, readonly so a constant or `as const` works, which the schema can't express. */
export type RecordWant = Readonly<ValueRecord>

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

/**
 * Compares two records by key, with each value compared exactly, so their key order doesn't count. `missing` and
 * `changed` keep `want`'s key order, and `extra` keeps the check's.
 */
export const compareRecords = (gotRecord: RecordWant, wantRecord: RecordWant): Comparison => {
  const missing = getEntriesNotIn(wantRecord, gotRecord)
  const changed = Object.fromEntries(
    Object.entries(wantRecord).flatMap(([key, want]) => {
      const got = gotRecord[key]
      return got !== undefined && got !== want ? [[key, { got, want }]] : []
    }),
  )
  const extra = getEntriesNotIn(gotRecord, wantRecord)

  const values: RecordComparisonValues = {
    kind: "record",
    got: { ...gotRecord },
    want: { ...wantRecord },
    missing,
    changed,
    extra,
  }
  const inSync = [missing, changed, extra].every((part) => Object.keys(part).length === 0)
  return { inSync, values }
}
