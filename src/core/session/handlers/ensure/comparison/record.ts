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
 * How a record the check gave differs from the one it wanted, by key. `missing` maps a key the host doesn't have to its
 * wanted value, `extra` maps a key `want` doesn't have to its current value, and `changed` maps a key both have to its
 * two values, because the pairing is the difference.
 */
export interface RecordDifference<V extends RecordValue = RecordValue> {
  missing: ValueRecord<V>
  extra: ValueRecord<V>
  changed: Record<string, { got: V; want: V }>
}

/** A record the check gave and the one it wanted, and how they differ. */
export interface RecordComparisonValues extends RecordDifference {
  kind: "record"
  got: ValueRecord
  want: ValueRecord
}

/** Returns the entries of `record` whose keys `others` doesn't have, in `record`'s key order. */
const getEntriesNotIn = (record: RecordWant, others: RecordWant): ValueRecord =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !Object.hasOwn(others, key)))

/**
 * Compares two records by key, with each value compared exactly, so their key order doesn't count. `missing` and
 * `changed` keep `want`'s key order, and `extra` keeps the check's.
 */
export const compareRecords = (gotRecord: RecordWant, wantRecord: RecordWant): Comparison => {
  const missing = getEntriesNotIn(wantRecord, gotRecord)
  const extra = getEntriesNotIn(gotRecord, wantRecord)
  const changed = Object.fromEntries(
    Object.entries(wantRecord).flatMap(([key, want]) => {
      const got = gotRecord[key]
      return got !== undefined && got !== want ? [[key, { got, want }]] : []
    }),
  )

  const values: RecordComparisonValues = {
    kind: "record",
    got: { ...gotRecord },
    want: { ...wantRecord },
    missing,
    extra,
    changed,
  }
  const inSync = [missing, extra, changed].every((part) => Object.keys(part).length === 0)
  return { inSync, values }
}
