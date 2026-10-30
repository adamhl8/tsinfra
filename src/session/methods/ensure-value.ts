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

const compareToWant = (value: string, want: string): CheckResult => {
  const read = stripTrailingNewlines(value)
  const wanted = stripTrailingNewlines(want)
  return read === wanted ? { checkPassed: true } : { checkPassed: false, detail: `read: ${read}\nwant: ${wanted}` }
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
    if (!exitError) return checkResult

    // Fail a broken read whose output happens to match, so it can't look converged.
    if (checkResult.checkPassed) return err(`failed to check step '${stepCall.stepName}'`, exitError)

    // Keep the exit error in the detail, because it can show that the read itself is broken.
    return { checkPassed: false, detail: `${checkResult.detail ?? ""}\n${exitError.message}` }
  }

  return converge(stepCall, evaluate, fix)
}
