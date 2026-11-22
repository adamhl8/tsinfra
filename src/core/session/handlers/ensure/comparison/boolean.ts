import { type } from "arktype"

import type { Comparison } from "#core/session/handlers/shared/converge.ts"

/** A boolean `want`, which a command's exit status or a function's value must match. */
export const booleanWantSchema = type("boolean")
export type BooleanWant = typeof booleanWantSchema.infer

/** What a boolean's fix gets. */
export interface BooleanDifference {
  /** The value the step wants. The host's is its opposite. */
  want: BooleanWant
}

/** A boolean a check function returned and the one it wanted. */
export interface BooleanComparisonValues {
  kind: "boolean"
  got: BooleanWant
  want: BooleanWant
}

/** A check command's exit code and the wanted boolean, where `true` means exit 0. */
export interface ExitComparisonValues {
  kind: "exit"
  got: number
  want: BooleanWant
}

/** Compares a check function's boolean to `want`. */
export const compareBooleans = (got: BooleanWant, want: BooleanWant): Comparison<BooleanComparisonValues> => ({
  inSync: got === want,
  values: { kind: "boolean", got, want },
})

/** Compares a check command's exit code to `want`, which is `true` for exit 0. */
export const compareExitCode = (exitCode: number, want: BooleanWant): Comparison<ExitComparisonValues> => ({
  inSync: (exitCode === 0) === want,
  values: { kind: "exit", got: exitCode, want },
})
