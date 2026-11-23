import type { RecordValue, RecordWant } from "#core/session/handlers/ensure/comparison/record.ts"
import type { NonRecordValue } from "#core/session/handlers/ensure/comparison/record/difference.ts"
import { isNestedRecord } from "#core/session/handlers/ensure/comparison/record/nested-kinds.ts"
import type { IndexSignatureKey, LiteralKey, Simplify } from "#core/session/handlers/ensure/comparison/record/utils.ts"

/**
 * `want`'s shape with a mark for each value, so each literal key is optional. A key only the host has is typed only
 * where `want` has an index signature, the way `got` has `want`'s type.
 */
export type DifferingRecord<T> = Simplify<DifferingIndexSignature<T> & DifferingLiteralKeys<T>>

// Keep an index signature as one, so `Object.values` doesn't add `undefined`.
type DifferingIndexSignature<T> = {
  readonly [K in keyof T as IndexSignatureKey<K>]: DifferingMark<Exclude<T[K], undefined>>
}

type DifferingLiteralKeys<T> = {
  readonly [K in keyof T as LiteralKey<K>]?: DifferingMark<Exclude<T[K], undefined>>
}

/** The mark for a value of type `V`: `true`, or for a record, the marks of its keys. */
// Mark a value that can be a record with `true` too, because an empty wanted record has no keys to mark.
// Distribute over `V`, so a union of a string and a record gives `true` or the record's marks.
export type DifferingMark<V> = V extends NonRecordValue ? true : true | DifferingRecord<V>

/** Marks each key of `extra`, the host's keys that `want` doesn't have, as `true`. */
export const markExtraKeys = (extra: RecordWant): DifferingRecord<RecordWant> =>
  Object.fromEntries(Object.keys(extra).map((key) => [key, true]))

/**
 * Marks every key of a wanted record at every depth, for a host that doesn't have the record. An empty record is `true`
 * itself, because it has no keys to mark.
 */
export const markAllKeys = (want: RecordWant): DifferingMark<RecordValue> => {
  const entries = Object.entries(want)
  if (entries.length === 0) return true
  const markedEntries = entries.map(([key, value]): [string, DifferingMark<RecordValue>] => {
    const mark = isNestedRecord(value) ? markAllKeys(value) : true
    return [key, mark]
  })
  return Object.fromEntries(markedEntries)
}
