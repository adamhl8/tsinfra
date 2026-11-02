import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import type { HostState } from "#session/converge.ts"
import { converge } from "#session/converge.ts"
import { createCommandExitError } from "#session/shell.ts"
import type { Change } from "#session/step-functions/change.ts"
import { runChange } from "#session/step-functions/change.ts"
import type { Check, CheckCompare } from "#session/step-functions/check.ts"
import { runCheck } from "#session/step-functions/check.ts"
import type { NeededSteps, StepContext, StepDetails } from "#session/step.ts"
import { needsSchema } from "#session/step.ts"
import type { CommandOutput } from "#transport/transport.ts"
import { stripTrailingNewlines } from "#utils.ts"

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
  /**
   * Earlier steps this step's check depends on. In `plan`, the step waits instead of checking when one of them would
   * change or is waiting. A run's result can't be needed, so need the step that triggered the run instead.
   */
  needs?: NeededSteps
}

/** What the check gave and what it wanted, as raw values. `kind` says how the output shows them. */
export type ValueComparison =
  | { kind: "string"; got: string; want: string }
  | { kind: "boolean"; got: boolean; want: boolean }
  // `got` is the exit code, and `want: true` means exit 0.
  | { kind: "exit"; got: number; want: boolean }

const compareStrings = (value: string, wantedValue: string): HostState => {
  const got = stripTrailingNewlines(value)
  const want = stripTrailingNewlines(wantedValue)
  return { inSync: got === want, comparison: { kind: "string", got, want } }
}

/** Compares a check function's value to `want`. */
const compareFnValue = (value: unknown, want: string | boolean): Result<HostState> => {
  if (typeof value === "string" && typeof want === "string") return compareStrings(value, want)

  if (typeof value === "boolean" && typeof want === "boolean")
    return { inSync: value === want, comparison: { kind: "boolean", got: value, want } }

  return err(`the check returned a ${typeof value}, but want is a ${typeof want}`, undefined)
}

/** Compares a check command's stdout, or its exit code, to `want`. */
const compareCmdValue = (commandOutput: CommandOutput, want: string | boolean): Result<HostState> => {
  const { stdout, exitCode } = commandOutput

  if (typeof want === "string") {
    const hostState = compareStrings(stdout, want)

    // Fail a broken check whose output happens to match, so it can't look converged.
    if (exitCode !== 0 && hostState.inSync) return createCommandExitError(commandOutput)

    return { ...hostState, commandOutput }
  }

  if (typeof want === "boolean")
    return { inSync: (exitCode === 0) === want, comparison: { kind: "exit", got: exitCode, want }, commandOutput }

  return err(`want must be a string or a boolean, but is a ${typeof want}`, undefined)
}

export const handleEnsure = async <T extends string | boolean>(
  ctx: StepContext,
  options: EnsureOptions<T>,
): Promise<Result<StepDetails>> => {
  const { stepName } = ctx
  const { check, want, fix, verify = true, needs = [] } = options

  const validNeeds = needsSchema({ needs })
  if (validNeeds instanceof type.errors)
    return err(`failed to validate the needs of step '${stepName}'`, err(validNeeds.summary, undefined))

  const checkCompare: CheckCompare = {
    fnValue: (value) => compareFnValue(value, want),
    cmdValue: (commandOutput) => compareCmdValue(commandOutput, want),
  }

  const stepDetails = await converge(ctx, {
    needs,
    readState: async () => runCheck(ctx, check, checkCompare),
    fix: async () => runChange(ctx, fix),
    verify,
  })

  return stepDetails
}
