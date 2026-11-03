import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Change } from "#session/step-functions/change.ts"
import { changeSchema, runChange } from "#session/step-functions/change.ts"
import type { StepContext, StepDetails } from "#session/step.ts"
import { stepResultSchema } from "#session/step.ts"

// Accept steps that can change the host in `after`, including another run.
// Reject an empty array, because a run that follows nothing never runs, which is a mistake.
const triggerStepsSchema = stepResultSchema.and({ kind: "'file' | 'ensure' | 'run'" }).array().atLeastLength(1)
type TriggerSteps = typeof triggerStepsSchema.infer

export interface RunOptions {
  /**
   * The results of the steps this run follows, so it runs when any of them changed. `"always"` runs it on every pass,
   * for upkeep with no trigger. In `plan` a run never runs, and reports changed when it would, so the plan shows it.
   */
  after: TriggerSteps | "always"
}

// Validate the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
// Declare it against `RunOptions`, so the schema and the interface can't drift apart.
const runOptionsSchema = type.declare<RunOptions>().type({
  after: type("'always'").or(triggerStepsSchema),
})

/** Returns whether the run is due: on every pass for `"always"`, or when a step in `after` changed. */
const evaluateTrigger = (options: RunOptions): boolean => {
  const { after } = options
  if (after === "always") return true

  const didAnyStepChange = after.some((stepResult) => stepResult.changed)
  return didAnyStepChange
}

export const handleRun = async (
  ctx: StepContext,
  change: Change,
  options: RunOptions,
): Promise<Result<StepDetails>> => {
  const { stepName, mode } = ctx

  const validChange = changeSchema(change)
  if (validChange instanceof type.errors)
    return err(`failed to validate the command given to step '${stepName}'`, err(validChange.summary, undefined))

  const validOptions = runOptionsSchema(options)
  if (validOptions instanceof type.errors)
    return err(`failed to validate the options given to step '${stepName}'`, err(validOptions.summary, undefined))

  const shouldRun = evaluateTrigger(validOptions)
  if (!shouldRun) return { status: "unchanged", changed: false }
  if (mode === "plan") return { status: "ran", changed: true }

  const changeResult = await runChange(ctx, validChange)
  if (isErr(changeResult)) return err(`failed to run step '${stepName}'`, changeResult)

  return { status: "ran", changed: true }
}
