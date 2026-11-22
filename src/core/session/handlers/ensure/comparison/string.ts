import { type } from "arktype"

import type { Comparison } from "#core/session/handlers/shared/converge.ts"
import { stripTrailingNewlines } from "#utils.ts"

/** A string `want`, which a command's stdout or a function's value must match. */
export const stringWantSchema = type("string")
export type StringWant = typeof stringWantSchema.infer

/** What a string's fix gets. */
export interface StringDifference {
  /** What the check answered, with its trailing newlines stripped. */
  got: StringWant
  /** The string the step wants, with its trailing newlines stripped. */
  want: StringWant
}

/** A string the check gave and the one it wanted, with their trailing newlines stripped. */
export interface StringComparisonValues {
  kind: "string"
  got: StringWant
  want: StringWant
}

/** Compares two strings exactly, after stripping their trailing newlines, the way `$(cmd)` does. */
export const compareStrings = (gotString: StringWant, wantString: StringWant): Comparison<StringComparisonValues> => {
  const got = stripTrailingNewlines(gotString)
  const want = stripTrailingNewlines(wantString)
  const values: StringComparisonValues = { kind: "string", got, want }
  return { inSync: got === want, values }
}
