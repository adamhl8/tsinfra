import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import type { Want } from "#session/handlers/ensure/check.ts"
import type { ListComparisonValues } from "#session/handlers/ensure/comparison/list.ts"
import { compareLists, toListItems } from "#session/handlers/ensure/comparison/list.ts"
import type { StringComparisonValues } from "#session/handlers/ensure/comparison/string.ts"
import { compareStrings } from "#session/handlers/ensure/comparison/string.ts"
import type { HostCheckDetails } from "#session/handlers/ensure/host-check-details.ts"
import type { Comparison } from "#session/handlers/shared/shared.ts"
import type { CommandOutput } from "#transport/transport.ts"
import { createCommandExitError, describeType } from "#utils.ts"

export type { ListDifference } from "#session/handlers/ensure/comparison/list.ts"
export type { StringComparisonValues } from "#session/handlers/ensure/comparison/string.ts"

/** What the check gave and what it wanted, as raw values. `kind` says how the output shows them. */
export type EnsureComparisonValues =
  // `got` is the exit code, and `want: true` means exit 0.
  | { kind: "exit"; got: number; want: boolean }
  | { kind: "boolean"; got: boolean; want: boolean }
  | StringComparisonValues
  | ListComparisonValues

// Require the check's value to have `want`'s type, which `want` alone decides.
const checkFnValueSchema = type({ value: "boolean", want: "boolean" })
  .or({ value: "string", want: "string" })
  .or({ value: "string[]", want: "string[]" })

/**
 * Validates a check function's value against `want`'s type, then compares the two. The value is `unknown` because a
 * script can get past the types and return anything.
 */
const compareFnValue = (value: unknown, want: Want): Result<Comparison> => {
  const valid = checkFnValueSchema({ value, want })
  if (valid instanceof type.errors) {
    return err(
      "failed to validate the value the check returned",
      err(`it's of type ${describeType(value)}, but want is of type ${describeType(want)}`, undefined),
    )
  }

  // Narrow each side on its own, because the schema's pairs don't narrow together.
  const { value: gotValue, want: wantedValue } = valid
  if (typeof gotValue === "boolean" && typeof wantedValue === "boolean")
    return { inSync: gotValue === wantedValue, values: { kind: "boolean", got: gotValue, want: wantedValue } }
  if (typeof gotValue === "string" && typeof wantedValue === "string") return compareStrings(gotValue, wantedValue)
  if (Array.isArray(gotValue) && Array.isArray(wantedValue)) return compareLists(gotValue, wantedValue)

  return err("failed to validate the value the check returned", undefined)
}

/**
 * Returns `comparison`, or an error for a check that exited non-zero but whose output still matches, so a broken check
 * can't look converged.
 */
const withExitCodeChecked = (commandOutput: CommandOutput, comparison: Comparison): Result<Comparison> =>
  commandOutput.exitCode !== 0 && comparison.inSync ? createCommandExitError(commandOutput) : comparison

/** Compares a check command's stdout, its lines, or its exit code, to `want`. */
const compareCommandOutput = (commandOutput: CommandOutput, want: Want): Result<Comparison> => {
  const { stdout, exitCode } = commandOutput

  if (typeof want === "boolean")
    return { inSync: (exitCode === 0) === want, values: { kind: "exit", got: exitCode, want } }
  if (typeof want === "string") return withExitCodeChecked(commandOutput, compareStrings(stdout, want))
  return withExitCodeChecked(commandOutput, compareLists(toListItems(stdout), want))
}

/** Compares what the check found on the host to `want`. */
export const compareCheck = (hostCheckDetails: HostCheckDetails, want: Want): Result<Comparison> =>
  hostCheckDetails.kind === "function"
    ? compareFnValue(hostCheckDetails.value, want)
    : compareCommandOutput(hostCheckDetails.commandOutput, want)
