import type { Want } from "#session/handlers/ensure/check.ts"
import type { Change, Comparison } from "#session/handlers/shared/shared.ts"
import { changeSchema } from "#session/handlers/shared/shared.ts"

/**
 * What a fix function gets after its tools, which it can't work out from `want`: what the check answered for a string
 * `want`. A `want` that may be either gets it only when it's a string. Checks `[T]` so it doesn't split a union `T`.
 */
export type FixDifference<T extends Want> = [T] extends [string]
  ? { got: string }
  : [T] extends [boolean]
    ? undefined
    : { got: string } | undefined

/**
 * A step's fix: a `Change` whose function, for a `want` that can be a string, also gets its `FixDifference` after its
 * tools. A boolean `want` gives it nothing more, because `got` is just `!want`.
 */
export type Fix<T extends Want> = [T] extends [boolean] ? Change : Change<[difference: FixDifference<T>]>

// Validate a fix as a change, because both are a command or a function at runtime, and type it as a fix.
export const fixSchema = changeSchema.as<Fix<Want>>()

/** Returns what a fix function gets from how the check compared: `got` for a string, and nothing otherwise. */
export const toFixDifference = ({ values }: Comparison): FixDifference<Want> =>
  values.kind === "string" ? { got: values.got } : undefined
