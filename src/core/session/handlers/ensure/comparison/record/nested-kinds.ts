import type { RecordPrimitive, RecordValue, RecordWant } from "#core/session/handlers/ensure/comparison/record.ts"
import { isPlainObject } from "#utils.ts"

/** Checks whether `value` is a nested list, because `Array.isArray` doesn't narrow a readonly array. */
export const isNestedList = (value: RecordValue | undefined): value is readonly RecordValue[] => Array.isArray(value)

/** Checks whether `value` is a nested set, because `instanceof` doesn't narrow a `ReadonlySet`. */
export const isNestedSet = (value: RecordValue | undefined): value is ReadonlySet<RecordPrimitive> =>
  value instanceof Set

/** Checks whether `value` is a nested record, because `isPlainObject` narrows to a record of `unknown`. */
export const isNestedRecord = (value: RecordValue | undefined): value is RecordWant => isPlainObject(value)
