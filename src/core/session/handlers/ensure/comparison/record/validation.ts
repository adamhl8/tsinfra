import { type } from "arktype"

import { describeType, isPlainObject } from "#utils.ts"

/** A problem with a value inside a record, at its path from the record. */
interface RecordValueProblem {
  path: PropertyKey[]
  expected: string
  actual: string
}

// Name the JS types, like the error for a `want` of the wrong kind.
const RECORD_VALUE_TYPES = "a string, a number, a boolean, null, an array, a Set, or a plain object"
const SET_ITEM_TYPES = "a Set of strings, numbers, booleans, or null"

// Refuse `NaN` through ArkType's `number`, as a top-level `want` does.
const recordPrimitiveSchema = type("string | number | boolean | null")

/** Returns the problem with a `Set` that holds anything but primitives, or nothing when it holds only those. */
const findSetProblem = (set: Set<unknown>): RecordValueProblem | undefined => {
  // Filter rather than find, because the item that's wrong can be `undefined` itself.
  const wrongItems = [...set].filter((item) => !recordPrimitiveSchema.allows(item))
  if (wrongItems.length === 0) return undefined
  return {
    path: [],
    expected: SET_ITEM_TYPES,
    actual: `a Set holding an item of type '${describeType(wrongItems[0])}'`,
  }
}

/** Returns the keys and values of a list or a plain object, or nothing for any other value. */
const toEntries = (value: unknown): [PropertyKey, unknown][] | undefined => {
  if (Array.isArray(value)) return [...value.entries()]
  return isPlainObject(value) ? Object.entries(value) : undefined
}

/**
 * Returns the first problem with `value` as a record value, or nothing when it has none. Walks lists and records by
 * hand, because ArkType 2.2.10 lets bad items through a recursive union of arrays and index signatures. Refuses a list
 * or a record that holds one of `ancestors`, because masking it and showing it would never end. A value that appears
 * twice without holding itself is fine.
 *
 * Revisit this walk once ArkType validates that union, and resolves `Record<string, value>` inside `value`'s own
 * definition. The walk can then become a recursive scope, with a narrow left only for a `Set`'s items and for a value
 * that holds itself, because ArkType checks neither.
 */
export const findRecordValueProblem = (
  value: unknown,
  ancestors: ReadonlySet<unknown> = new Set(),
): RecordValueProblem | undefined => {
  if (recordPrimitiveSchema.allows(value)) return undefined
  if (value instanceof Set) return findSetProblem(value)

  const entries = toEntries(value)
  const expected = typeof value === "object" ? "a plain object" : RECORD_VALUE_TYPES
  // Name a number by its value, because a `NaN` would otherwise read as "number".
  const actual = typeof value === "number" ? String(value) : describeType(value)
  if (!entries) return { path: [], expected, actual }

  const valueAncestors = new Set([...ancestors, value])
  for (const [key, entryValue] of entries) {
    if (valueAncestors.has(entryValue)) {
      const holder = Array.isArray(entryValue) ? "a list" : "a record"
      return { path: [key], expected: "a value of its own", actual: `${holder} that holds it` }
    }

    const problem = findRecordValueProblem(entryValue, valueAncestors)
    if (problem) return { ...problem, path: [key, ...problem.path] }
  }
  return undefined
}
