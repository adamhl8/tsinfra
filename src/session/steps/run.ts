import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Change } from "#session/step-functions/change.ts"
import { runChange } from "#session/step-functions/change.ts"
import type { StepCall, StepDetails } from "#session/step.ts"

export interface RunOptions {
  /**
   * Runs the command on this pass when true. In `plan` it never runs, and reports changed when true, so the plan shows
   * it as "would run".
   */
  when: boolean
}

export const handleRun = async (
  stepCall: StepCall,
  change: Change,
  options: RunOptions,
): Promise<Result<StepDetails>> => {
  const { mode, stepName } = stepCall
  const { when } = options

  if (!when) return { status: "unchanged", changed: false }
  if (mode === "plan") return { status: "ran", changed: true }

  const changeResult = await runChange(stepCall, change)
  if (isErr(changeResult)) return err(`failed to run step '${stepName}'`, changeResult)

  return { status: "ran", changed: true }
}
