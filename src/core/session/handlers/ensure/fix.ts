import type { EnsureComparison } from "#core/session/handlers/ensure/comparison.ts"
import type { BooleanDifference } from "#core/session/handlers/ensure/comparison/boolean.ts"
import type { ListDifference, ListWant } from "#core/session/handlers/ensure/comparison/list.ts"
import type { RecordDifference } from "#core/session/handlers/ensure/comparison/record/difference.ts"
import { toRecordDifference } from "#core/session/handlers/ensure/comparison/record/difference.ts"
import type { SetDifference, SetWant } from "#core/session/handlers/ensure/comparison/set.ts"
import { toSetDifference } from "#core/session/handlers/ensure/comparison/set.ts"
import type { StringDifference, StringWant } from "#core/session/handlers/ensure/comparison/string.ts"
import type { IsRecordWant, SchemaWant, Want, WantOf } from "#core/session/handlers/ensure/want.ts"
import type { Change } from "#core/session/handlers/shared/change.ts"
import { changeSchema } from "#core/session/handlers/shared/change.ts"

/**
 * What a fix function gets after its tools: its kind's difference, with `want` and what the check found, so a fix never
 * compares anything itself. A set's and a record's difference take `want`'s type. A `want` that may be any kind gets
 * the union of them. Checks `[T]` so it doesn't split a union `T`.
 */
export type FixDifference<T extends WantOf<T>> = [T] extends [boolean]
  ? BooleanDifference
  : [T] extends [StringWant]
    ? StringDifference
    : [T] extends [ListWant]
      ? ListDifference
      : [T] extends [SetWant]
        ? SetDifference<T>
        : IsRecordWant<T> extends true
          ? RecordDifference<T>
          : BooleanDifference | StringDifference | ListDifference | SetDifference | RecordDifference

/** A step's fix: a `Change` whose function also gets its `FixDifference` after its tools. */
export type Fix<T extends WantOf<T>> = Change<[difference: FixDifference<T>]>

// Validate a fix as a change, because both are a command or a function at runtime, and type it as a fix.
export const fixSchema = changeSchema.as<Fix<SchemaWant>>()

/** Returns what a fix function gets from how the check compared: its kind's difference, built from the two sides. */
export const toFixDifference = ({ values }: EnsureComparison): FixDifference<Want> => {
  if (values.kind === "exit" || values.kind === "boolean") return { want: values.want }
  if (values.kind === "string") return { got: values.got, want: values.want }
  if (values.kind === "list") return { got: values.got, want: values.want }
  if (values.kind === "set") return toSetDifference(new Set(values.got), new Set(values.want))
  return toRecordDifference(values.got, values.want)
}
