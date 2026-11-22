import { type } from "arktype"
import { deepEqual } from "fast-equals"

import { getEntriesNotIn } from "#core/session/handlers/ensure/comparison/record/difference.ts"
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
 * Checks a record `want` by its own keys, so `T extends RecordWantOf<T>` holds when each value is a `RecordValue`. A
 * type an interface declares can't be a `RecordWant`, because TypeScript never gives an interface an index signature.
 */
export type RecordWantOf<T> = { readonly [K in keyof T]: RecordValueOf<T[K]> }

// Map a valid value to `unknown`, because a primitive here would keep `want`'s inferred values literal, like `"1"`.
// Refuse a function first, because a class instance like a `Date` would otherwise pass as a record of its methods.
type RecordValueOf<V> = V extends (...args: never) => unknown
  ? never
  : V extends RecordPrimitive | ReadonlySet<RecordPrimitive>
    ? unknown
    : V extends readonly (infer E)[]
      ? readonly RecordValueOf<E>[]
      : V extends object
        ? RecordWantOf<V>
        : never

/**
 * A record `want` as its schema types it, with mutable lists, which a `RecordWant` takes. Type the schemas with it,
 * because ArkType 2.2.10's inference never ends on a recursive readonly array. Once ArkType infers one, type the
 * schemas with `RecordWant` and `Want`, and delete this and `SchemaWant`.
 */
export interface SchemaRecordWant {
  [key: string]: SchemaRecordValue
}

type SchemaRecordValue = RecordPrimitive | SchemaRecordValue[] | ReadonlySet<RecordPrimitive> | SchemaRecordWant

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
 * A record the check gave and the one it wanted, and how they differ by top-level key. `missing` maps a key the host
 * doesn't have to its wanted value, `changed` maps a key both have to its two values, and `extra` maps a key `want`
 * doesn't have to the host's value.
 */
export interface RecordComparisonValues {
  kind: "record"
  got: RecordWant
  want: RecordWant
  missing: RecordWant
  changed: Record<string, { got: RecordValue; want: RecordValue }>
  extra: RecordWant
}

/**
 * Compares two records by key, with each value compared exactly and nested records compared the same way, so key order
 * doesn't count at any depth. Matches `-0` to `0`, because the report shows both as `0`. `missing` and `changed` keep
 * `want`'s key order, and `extra` keeps the check's. Each holds a top-level key's whole value.
 */
export const compareRecords = (gotRecord: RecordWant, wantRecord: RecordWant): Comparison<RecordComparisonValues> => {
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
