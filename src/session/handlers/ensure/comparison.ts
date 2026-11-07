import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import type { Want } from "#session/handlers/ensure/check.ts"
import type { HostCheckDetails } from "#session/handlers/ensure/host-check-details.ts"
import type { Comparison } from "#session/handlers/shared/converge.ts"
import { createCommandExitError } from "#session/shell.ts"
import type { CommandOutput } from "#transport/transport.ts"
import { stripTrailingNewlines } from "#utils.ts"

/** What the check gave and what it wanted, as raw values. `kind` says how the output shows them. */
export type EnsureComparisonValues =
  | { kind: "string"; got: string; want: string }
  | { kind: "boolean"; got: boolean; want: boolean }
  // `got` is the exit code, and `want: true` means exit 0.
  | { kind: "exit"; got: number; want: boolean }

// Require the check's value to have `want`'s type, which `want` alone decides.
const checkFnValueSchema = type({ value: "string", want: "string" }).or({ value: "boolean", want: "boolean" })

const compareStrings = (value: string, wantedValue: string): Comparison => {
  const got = stripTrailingNewlines(value)
  const want = stripTrailingNewlines(wantedValue)
  return { inSync: got === want, values: { kind: "string", got, want } }
}

/**
 * Validates a check function's value against `want`'s type, then compares the two. The value is `unknown` because a
 * script can get past the types and return anything.
 */
const compareFnValue = (value: unknown, want: Want): Result<Comparison> => {
  const valid = checkFnValueSchema({ value, want })
  if (valid instanceof type.errors) {
    return err(
      "failed to validate the value the check returned",
      err(`it's of type ${typeof value}, but want is of type ${typeof want}`, undefined),
    )
  }

  if (typeof valid.want === "string") return compareStrings(valid.value, valid.want)

  return { inSync: valid.value === valid.want, values: { kind: "boolean", got: valid.value, want: valid.want } }
}

/** Compares a check command's stdout, or its exit code, to `want`. */
const compareCommandOutput = (commandOutput: CommandOutput, want: Want): Result<Comparison> => {
  const { stdout, exitCode } = commandOutput

  if (typeof want === "string") {
    const comparison = compareStrings(stdout, want)

    // Fail a broken check whose output happens to match, so it can't look converged.
    if (exitCode !== 0 && comparison.inSync) return createCommandExitError(commandOutput)

    return comparison
  }

  return { inSync: (exitCode === 0) === want, values: { kind: "exit", got: exitCode, want } }
}

/** Compares what the check found on the host to `want`. */
export const compareCheck = (hostCheckDetails: HostCheckDetails, want: Want): Result<Comparison> =>
  hostCheckDetails.kind === "function"
    ? compareFnValue(hostCheckDetails.value, want)
    : compareCommandOutput(hostCheckDetails.commandOutput, want)
