import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Action, StepCall, StepDetails } from "#session/step.ts"
import { runAction } from "#session/step.ts"

export interface RunOptions {
  /**
   * Runs the action on this pass when true. In `plan` it never runs, and reports changed when true, so the plan shows
   * it as "would run".
   */
  when: boolean
}

export const handleRun = async (
  stepCall: StepCall,
  action: Action,
  options: RunOptions,
): Promise<Result<StepDetails>> => {
  const { mode, stepName } = stepCall
  const { when } = options

  if (!when) return { status: "ok", changed: false }
  if (mode === "plan") return { status: "ran", changed: true }

  const actionResult = await runAction(stepCall, action)
  if (isErr(actionResult)) return err(`failed to run step '${stepName}'`, actionResult)

  return { status: "ran", changed: true }
}
