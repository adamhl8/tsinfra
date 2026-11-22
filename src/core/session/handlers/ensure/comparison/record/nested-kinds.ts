import type { RecordPrimitive, RecordValue, RecordWant } from "#core/session/handlers/ensure/comparison/record.ts"
import { isPlainObject } from "#utils.ts"

/** Checks whether `value` is a nested list, because `Array.isArray` doesn't narrow a readonly array. */
export const isRecordList = (value: RecordValue | undefined): value is readonly RecordValue[] => Array.isArray(value)

/** Checks whether `value` is a nested set, because `instanceof` doesn't narrow a `ReadonlySet`. */
export const isRecordSet = (value: RecordValue | undefined): value is ReadonlySet<RecordPrimitive> =>
  value instanceof Set

/** Checks whether `value` is a nested record, because `isPlainObject` narrows to a record of `unknown`. */
export const isRecordRecord = (value: RecordValue | undefined): value is RecordWant => isPlainObject(value)
