import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Change } from "#session/step-functions/change.ts"
import { runChange } from "#session/step-functions/change.ts"
import type { StepCall, StepDetails, StepResult } from "#session/step.ts"
import { stepResultSchema } from "#session/step.ts"

export interface RunOptions {
  /**
   * The results of the steps this run follows, so it runs when any of them changed. `"always"` runs it on every pass,
   * for upkeep with no trigger. In `plan` a run never runs, and reports changed when it would, so the plan shows it.
   */
  after: StepResult[] | "always"
}

// Check the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
// Reject an empty `after`, because a run that follows nothing never runs, which is a mistake.
const runOptionsSchema = type({
  after: type("'always'").or(stepResultSchema.array().atLeastLength(1)),
})

/** Returns whether the run is due: on every pass for `"always"`, or when a step in `after` changed. */
const evaluateTrigger = (options: RunOptions): Result<boolean> => {
  const validOptions = runOptionsSchema(options)
  if (validOptions instanceof type.errors) return err(validOptions.summary, undefined)

  const { after } = validOptions
  if (after === "always") return true

  const didAnyStepChange = after.some((stepResult) => stepResult.changed)
  return didAnyStepChange
}

export const handleRun = async (
  stepCall: StepCall,
  change: Change,
  options: RunOptions,
): Promise<Result<StepDetails>> => {
  const { mode, stepName } = stepCall

  const shouldRun = evaluateTrigger(options)
  if (isErr(shouldRun)) return err(`failed to run step '${stepName}'`, shouldRun)

  if (!shouldRun) return { status: "unchanged", changed: false }
  if (mode === "plan") return { status: "ran", changed: true }

  const changeResult = await runChange(stepCall, change)
  if (isErr(changeResult)) return err(`failed to run step '${stepName}'`, changeResult)

  return { status: "ran", changed: true }
}
