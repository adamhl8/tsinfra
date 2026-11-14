import type { Comparison } from "#session/handlers/shared/shared.ts"
import { stripTrailingNewlines } from "#utils.ts"

/** A string the check gave and the one it wanted, with their trailing newlines stripped. */
export interface StringComparisonValues {
  kind: "string"
  got: string
  want: string
}

/** Compares two strings exactly, after stripping their trailing newlines, the way `$(cmd)` does. */
export const compareStrings = (value: string, wantedValue: string): Comparison => {
  const got = stripTrailingNewlines(value)
  const want = stripTrailingNewlines(wantedValue)
  const values: StringComparisonValues = { kind: "string", got, want }
  return { inSync: got === want, values }
}
