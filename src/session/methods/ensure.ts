import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { CheckResult, FixOptions } from "#session/converge.ts"
import { converge, runCheck } from "#session/converge.ts"
import type { StepCall, StepResult } from "#session/step.ts"

export interface EnsureOptions extends FixOptions {
  /**
   * A command where exit 0 means already right, or a function that returns true when already right. It also runs during
   * `plan`, so it must not change anything.
   */
  check: string | (() => Promise<boolean>)
}

export const handleEnsure = async (stepCall: StepCall, options: EnsureOptions): Promise<Result<StepResult>> => {
  const { check, ...fixOptions } = options

  const evaluate = async (): Promise<Result<CheckResult>> => {
    const checkRun = await runCheck(stepCall, check)
    if (isErr(checkRun)) return checkRun
    if (checkRun.type === "function") return { checkPassed: checkRun.value }

    const { exitError } = checkRun.commandResult
    return { checkPassed: exitError === undefined, exitError }
  }

  return converge(stepCall, evaluate, fixOptions)
}
