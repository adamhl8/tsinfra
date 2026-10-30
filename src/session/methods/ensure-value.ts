import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { stripTrailingNewlines } from "#session/shell.ts"
import type { CheckResult, FixOptions, StepCall, StepResult } from "#session/step.ts"
import { converge, runCheck } from "#session/step.ts"

export interface EnsureValueOptions extends FixOptions {
  /**
   * A command whose output is compared to `want`, or a function that returns the value to compare. It also runs during
   * `plan`, so it must not change anything.
   */
  read: string | (() => Promise<string>)
  /** The value `read` should produce. Trailing newlines are ignored on both sides. */
  want: string
}

const compareToWant = (value: string, wantedValue: string): CheckResult => {
  const read = stripTrailingNewlines(value)
  const want = stripTrailingNewlines(wantedValue)
  return read === want ? { checkPassed: true } : { checkPassed: false, mismatch: { read, want } }
}

export const runEnsureValue = async (
  stepCall: StepCall,
  { read, want, fix }: EnsureValueOptions,
): Promise<Result<StepResult>> => {
  const evaluate = async (): Promise<Result<CheckResult>> => {
    const checkRun = await runCheck(stepCall, read)
    if (isErr(checkRun)) return checkRun
    if (checkRun.type === "function") return compareToWant(checkRun.value, want)

    const { stdout, exitError } = checkRun.commandResult
    const checkResult = compareToWant(stdout, want)

    // Fail a broken read whose output happens to match, so it can't look converged.
    if (exitError && checkResult.checkPassed) return err(`failed to check step '${stepCall.stepName}'`, exitError)

    return { ...checkResult, exitError }
  }

  return converge(stepCall, evaluate, fix)
}
