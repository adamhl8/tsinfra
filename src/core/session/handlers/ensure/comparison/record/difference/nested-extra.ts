import type { RecordPrimitive, RecordValue, RecordWant } from "#core/session/handlers/ensure/comparison/record.ts"
import type { NonRecordValue, RecordValueIn } from "#core/session/handlers/ensure/comparison/record/difference.ts"
import type { IsNever } from "#core/session/handlers/ensure/comparison/record/utils.ts"

/** A record difference's `nestedExtra`, or `never` when `want` can't nest a record or a set, because it would be empty. */
// Spell out the union, so a hover shows the entry types rather than an alias.
export type NestedExtraList<T> =
  IsNever<NestedExtraKeyOf<T> | NestedExtraItemsOf<T>> extends true
    ? never
    : (NestedExtraKeyOf<T> | NestedExtraItemsOf<T>)[]

/** A key the host has in a nested record that `want` doesn't. */
export interface NestedExtraKey<V = RecordValue> {
  /** Marks a key in a nested record, as opposed to a nested set's items. */
  kind: "key"
  /** The keys from the top-level key down to the extra one, like `["env", "DEBUG"]`. */
  path: readonly [string, ...string[], string]
  /** The host's value at `path`. */
  value: V
}

/** The items the host has in a nested set that `want` doesn't. */
export interface NestedExtraItems<I = RecordPrimitive> {
  /** Marks a nested set's items, as opposed to a key in a nested record. */
  kind: "items"
  /** The keys from the top-level key down to the set, like `["packages"]`. */
  path: readonly [string, ...string[]]
  /** The items the host's set has that `want`'s doesn't, in the host's order. */
  value: I[]
}

/** A `nestedExtra` entry for any record, as the comparison builds it and the report reads it. */
export type NestedExtraEntry = NestedExtraKey | NestedExtraItems

// Type a key entry's value by the values of `T`'s nested records.
type NestedExtraKeyOf<T> =
  IsNever<NestedRecordsOf<T>> extends true ? never : NestedExtraKey<RecordValueIn<NestedRecordsOf<T>>>

// Type an items entry's items by the items of `T`'s nested sets.
type NestedExtraItemsOf<T> = IsNever<NestedSetItemsOf<T>> extends true ? never : NestedExtraItems<NestedSetItemsOf<T>>

/** The records nested in `T`'s values, at any depth. */
type NestedRecordsOf<T> = NestedRecordsIn<RecordValueIn<T>>

/**
 * The records in `V` and nested in them. A list's items are never extra, so it isn't entered. Stops at a record already
 * seen, because a recursive type like a dict of dicts would never end. Stops 8 levels down with any record, because
 * each level of a generic `V` is a new type, so none is ever seen. A concrete `want` ends before that.
 */
type NestedRecordsIn<V, Seen = never, Depth extends unknown[] = []> = Depth["length"] extends 8
  ? RecordWant
  : V extends NonRecordValue
    ? never
    : V extends object
      ? [V] extends [Seen]
        ? never
        : V | NestedRecordsIn<RecordValueIn<V>, Seen | V, [...Depth, unknown]>
      : never

/** The items of the sets in `T`'s values and in its nested records. */
// Infer `V` rather than pass the union to a helper like `set.ts`'s `SetItemOf`, which takes over twice the check time.
type NestedSetItemsOf<T> = RecordValueIn<T> | RecordValueIn<NestedRecordsOf<T>> extends infer V
  ? V extends ReadonlySet<infer I>
    ? I
    : never
  : never
