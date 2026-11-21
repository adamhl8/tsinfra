import type { ListDifference, ListWant } from "#core/session/handlers/ensure/comparison/list.ts"
import type { RecordDifference } from "#core/session/handlers/ensure/comparison/record.ts"
import { toUnmet } from "#core/session/handlers/ensure/comparison/record.ts"
import type { SetDifference, SetWant } from "#core/session/handlers/ensure/comparison/set.ts"
import type { StringDifference, StringWant } from "#core/session/handlers/ensure/comparison/string.ts"
import type { IsRecordWant, SchemaWant, Want, WantOf } from "#core/session/handlers/ensure/want.ts"
import type { Change } from "#core/session/handlers/shared/change.ts"
import { changeSchema } from "#core/session/handlers/shared/change.ts"
import type { Comparison } from "#core/session/handlers/shared/converge.ts"

/**
 * What a fix function gets after its tools, which it can't work out from `want`: what the check answered for a string
 * or a list `want`, what's missing and extra for a set, and what's missing, changed, and extra for a record. A record
 * also gets `unmet`, which repeats `missing` and `changed` for a fix that sets every wanted value. A list gets its
 * `got`, because `missing` and `extra` can't describe a reorder. A set's or a record's `got` isn't passed, because it
 * can be rebuilt from `want` and its parts. A record's difference holds the type of `want`'s values, so a `want` of
 * strings gets strings. A `want` that may be any of them gets the one for its kind. Checks `[T]` so it doesn't split a
 * union `T`.
 */
export type FixDifference<T extends WantOf<T>> = [T] extends [boolean]
  ? undefined
  : [T] extends [StringWant]
    ? StringDifference
    : [T] extends [ListWant]
      ? ListDifference
      : [T] extends [SetWant]
        ? SetDifference
        : IsRecordWant<T> extends true
          ? RecordDifference<RecordValueIn<T>>
          : undefined | StringDifference | ListDifference | SetDifference | RecordDifference

// Distribute over `T`, so a union of records gives each one's values.
// Leave out `undefined`, which an optional key adds, because validation refuses it as a value.
type RecordValueIn<T> = T extends unknown ? Exclude<T[keyof T], undefined> : never

/**
 * A step's fix: a `Change` whose function, for a `want` that can be a string, also gets its `FixDifference` after its
 * tools. A boolean `want` gives it nothing more, because `got` is just `!want`.
 */
export type Fix<T extends WantOf<T>> = [T] extends [boolean] ? Change : Change<[difference: FixDifference<T>]>

// Validate a fix as a change, because both are a command or a function at runtime, and type it as a fix.
export const fixSchema = changeSchema.as<Fix<SchemaWant>>()

/**
 * Returns what a fix function gets from how the check compared: nothing for a boolean, `got` for a string or a list,
 * and the parts for a set or a record.
 */
export const toFixDifference = ({ values }: Comparison): FixDifference<Want> => {
  if (values.kind === "string") return { got: values.got }
  if (values.kind === "list") return { got: values.got }
  if (values.kind === "set") return { missing: values.missing, extra: values.extra }
  if (values.kind === "record")
    return { missing: values.missing, changed: values.changed, unmet: toUnmet(values), extra: values.extra }
  return undefined
}
