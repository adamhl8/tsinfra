import { type } from "arktype"

import type { Comparison } from "#session/handlers/shared/shared.ts"
import { stripTrailingNewlines } from "#utils.ts"

/** A string `want`, which a command's stdout or a function's value must match. */
export const stringWantSchema = type("string")
export type StringWant = typeof stringWantSchema.infer

/** A string the check gave and the one it wanted, with their trailing newlines stripped. */
export interface StringComparisonValues {
  kind: "string"
  got: StringWant
  want: StringWant
}

/** Compares two strings exactly, after stripping their trailing newlines, the way `$(cmd)` does. */
export const compareStrings = (value: StringWant, wantedValue: StringWant): Comparison => {
  const got = stripTrailingNewlines(value)
  const want = stripTrailingNewlines(wantedValue)
  const values: StringComparisonValues = { kind: "string", got, want }
  return { inSync: got === want, values }
}
