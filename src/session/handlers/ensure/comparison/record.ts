import { type } from "arktype"

import type { Comparison } from "#session/handlers/shared/shared.ts"

/** An object `want`, of string keys and string values, which a function's object must match by key. */
export const recordWantSchema = type("Record<string, string>")
type StringRecord = typeof recordWantSchema.infer

/** An object `want` as a script passes it, readonly so a constant or `as const` works, which the schema can't express. */
export type RecordWant = Readonly<StringRecord>

/**
 * How a record the check gave differs from the one it wanted, by key. `missing` maps a key the host doesn't have to its
 * wanted value, `extra` maps a key `want` doesn't have to its current value, and `changed` maps a key both have to its
 * two values, because the pairing is the difference.
 */
export interface RecordDifference {
  missing: StringRecord
  extra: StringRecord
  changed: Record<string, { got: string; want: string }>
}

/** A record the check gave and the one it wanted, and how they differ. */
export interface RecordComparisonValues extends RecordDifference {
  kind: "record"
  got: StringRecord
  want: StringRecord
}

/** Reports whether `value` is a record, an object that isn't an array, because a list is an object too. */
export const isRecord = (value: unknown): value is RecordWant =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Returns the entries of `record` whose keys `others` doesn't have, in `record`'s key order. */
const getEntriesNotIn = (record: RecordWant, others: RecordWant): StringRecord =>
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
