import type { Want } from "#session/handlers/ensure/check.ts"
import type { ListDifference, StringComparisonValues } from "#session/handlers/ensure/comparison/comparison.ts"
import type { Change, Comparison } from "#session/handlers/shared/shared.ts"
import { changeSchema } from "#session/handlers/shared/shared.ts"

/** What a string's fix gets: what the check answered. */
type StringDifference = Pick<StringComparisonValues, "got">

/**
 * What a fix function gets after its tools, which it can't work out from `want`: what the check answered for a string
 * `want`, and what's missing and extra for a list. A list's `got` isn't passed, because it's `want` minus `missing`,
 * plus `extra`. A `want` that may be any of them gets the one for its kind. Checks `[T]` so it doesn't split a union
 * `T`.
 */
export type FixDifference<T extends Want> = [T] extends [boolean]
  ? undefined
  : [T] extends [string]
    ? StringDifference
    : [T] extends [readonly string[]]
      ? ListDifference
      : undefined | StringDifference | ListDifference

/**
 * A step's fix: a `Change` whose function, for a `want` that can be a string, also gets its `FixDifference` after its
 * tools. A boolean `want` gives it nothing more, because `got` is just `!want`.
 */
export type Fix<T extends Want> = [T] extends [boolean] ? Change : Change<[difference: FixDifference<T>]>

// Validate a fix as a change, because both are a command or a function at runtime, and type it as a fix.
export const fixSchema = changeSchema.as<Fix<Want>>()

/**
 * Returns what a fix function gets from how the check compared: nothing for a boolean, `got` for a string, and the
 * parts for a list.
 */
export const toFixDifference = ({ values }: Comparison): FixDifference<Want> => {
  if (values.kind === "string") return { got: values.got }
  if (values.kind === "list") return { missing: values.missing, extra: values.extra }
  return undefined
}
