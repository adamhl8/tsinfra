import { type } from "arktype"
import { isEmpty, isPlainObject } from "remeda"

import type { RecordDifference } from "#core/session/handlers/ensure/comparison/record/difference.ts"
import { toRecordDifference } from "#core/session/handlers/ensure/comparison/record/difference.ts"
import { findRecordValueProblem } from "#core/session/handlers/ensure/comparison/record/validation.ts"
import type { Comparison } from "#core/session/handlers/shared/converge.ts"

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

/** A record the check gave and the one it wanted, and their difference, which the fix and the report both read. */
export interface RecordComparisonValues extends RecordDifference {
  kind: "record"
}

/**
 * Compares two records at every depth, with each value compared exactly, so key order doesn't count and `-0` matches
 * `0`, because the report shows both as `0`. Records their difference, so the report shows what the fix acts on.
 */
export const compareRecords = (gotRecord: RecordWant, wantRecord: RecordWant): Comparison<RecordComparisonValues> => {
  // Copy both, so a script that changes its own records after the step can't change what was recorded.
  const got = structuredClone(gotRecord)
  const want = structuredClone(wantRecord)

  const values: RecordComparisonValues = { kind: "record", ...toRecordDifference(got, want) }
  const inSync = isEmpty(values.differing)
  return { inSync, values }
}
