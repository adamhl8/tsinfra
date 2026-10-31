import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { CheckResult, FixOptions } from "#session/methods/converge/converge.ts"
import { converge, runCheck } from "#session/methods/converge/converge.ts"
import type { ReadTools } from "#session/methods/read.ts"
import { stripTrailingNewlines } from "#session/shell.ts"
import type { StepCall, StepDetails } from "#session/step.ts"

export interface EnsureValueOptions extends FixOptions {
  /**
   * A command whose output is compared to `want`, or a function given `read` that returns the value to compare. It also
   * runs during `plan`, so it must not change anything.
   */
  read: string | ((tools: ReadTools) => Promise<string>)
  /** The value `read` should produce. Trailing newlines are ignored on both sides. */
  want: string
}

const compareToWant = (value: string, wantedValue: string): CheckResult => {
  const read = stripTrailingNewlines(value)
  const want = stripTrailingNewlines(wantedValue)
  return read === want ? { checkPassed: true } : { checkPassed: false, mismatch: { read, want } }
}

export const handleEnsureValue = async (
  stepCall: StepCall,
  options: EnsureValueOptions,
): Promise<Result<StepDetails>> => {
  const { read, want, ...fixOptions } = options

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

  return converge(stepCall, evaluate, fixOptions)
}
