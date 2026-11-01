import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import type { HostState } from "#session/converge.ts"
import { converge } from "#session/converge.ts"
import { createCommandExitError, stripTrailingNewlines } from "#session/shell.ts"
import type { Change } from "#session/step-functions/change.ts"
import { runChange } from "#session/step-functions/change.ts"
import type { Check, CheckCompare } from "#session/step-functions/check.ts"
import { runCheck } from "#session/step-functions/check.ts"
import type { StepCall, StepDetails } from "#session/step.ts"
import type { CommandResult } from "#transport/transport.ts"

/** `T` ties a check function's return type to `want`, so a boolean check can't be compared to a string. */
export interface EnsureOptions<T extends string | boolean> {
  /**
   * A command, or a function given `read` that returns the value to compare. It also runs during `plan`, so it must not
   * change anything.
   */
  check: Check<T>
  /**
   * The answer `check` gives when already right. `true` means a command exits 0, and `false` means it exits non-zero. A
   * string is compared to a command's stdout. Trailing newlines are ignored on both sides.
   */
  want: T
  /** A command, or a function that runs several commands by calling `exec`. It only runs in `apply`. */
  fix: Change
  /**
   * Runs the check again after the fix, and fails the step when it still fails. Defaults to true. Set it to false only
   * for a fix whose effect nothing in the run can make visible, like one that needs a reboot.
   */
  verify?: boolean
}

const compareStrings = (value: string, wantedValue: string): HostState => {
  const got = stripTrailingNewlines(value)
  const want = stripTrailingNewlines(wantedValue)
  return { inSync: got === want, comparison: { kind: "string", got, want } }
}

/** Compares a check function's value to `want`. */
const compareFnResult = (value: unknown, want: string | boolean): Result<HostState> => {
  if (typeof value === "string" && typeof want === "string") return compareStrings(value, want)

  if (typeof value === "boolean" && typeof want === "boolean")
    return { inSync: value === want, comparison: { kind: "boolean", got: value, want } }

  return err(`the check returned a ${typeof value}, but want is a ${typeof want}`, undefined)
}

/** Compares a check command's stdout, or its exit code, to `want`. */
const compareCmdResult = (commandResult: CommandResult, want: string | boolean): Result<HostState> => {
  const { stdout, exitCode } = commandResult

  if (typeof want === "string") {
    const hostState = compareStrings(stdout, want)

    // Fail a broken check whose output happens to match, so it can't look converged.
    if (exitCode !== 0 && hostState.inSync) return createCommandExitError(commandResult)

    return { ...hostState, commandResult }
  }

  if (typeof want === "boolean")
    return { inSync: (exitCode === 0) === want, comparison: { kind: "exit", got: exitCode, want }, commandResult }

  return err(`want must be a string or a boolean, but is a ${typeof want}`, undefined)
}

export const handleEnsure = async <T extends string | boolean>(
  stepCall: StepCall,
  options: EnsureOptions<T>,
): Promise<Result<StepDetails>> => {
  const { check, want, fix, verify = true } = options

  const checkCompare: CheckCompare = {
    fnResult: (value) => compareFnResult(value, want),
    cmdResult: (commandResult) => compareCmdResult(commandResult, want),
  }

  const stepDetails = await converge(stepCall, {
    readState: async () => runCheck(stepCall, check, checkCompare),
    fix: async () => runChange(stepCall, fix),
    verify,
  })

  return stepDetails
}
