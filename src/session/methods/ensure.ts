import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { CheckResult, FixOptions, StepCall, StepResult } from "#session/step.ts"
import { callCheckFunction, converge } from "#session/step.ts"

export interface EnsureOptions extends FixOptions {
  /**
   * A command where exit 0 means already right, or a function that returns true when already right. It also runs during
   * `plan`, so it must not change anything.
   */
  check: string | (() => Promise<boolean>)
}

const evaluateCheck = async (
  { shell, stepName }: StepCall,
  check: EnsureOptions["check"],
): Promise<Result<CheckResult>> => {
  if (typeof check === "function") {
    const checkPassed = await callCheckFunction(stepName, check)
    if (isErr(checkPassed)) return checkPassed

    return { checkPassed }
  }

  const output = await shell.inspect(check)
  if (isErr(output)) return err(`failed to check step '${stepName}'`, output)
  if (output.exitError) return { checkPassed: false, detail: output.exitError.message }

  return { checkPassed: true }
}

export const runEnsure = async (stepCall: StepCall, { check, fix }: EnsureOptions): Promise<Result<StepResult>> =>
  converge(stepCall, async () => evaluateCheck(stepCall, check), fix)
