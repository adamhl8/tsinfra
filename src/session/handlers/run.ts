import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { ChangeStepResult } from "#session/handlers/shared/change-step-result.ts"
import { changeStepResultSchema, withChangeStepResult } from "#session/handlers/shared/change-step-result.ts"
import { changeSchema, runChange } from "#session/handlers/shared/change.ts"
import type { StepContext, HandlerReturn } from "#session/step.ts"

/** What makes a run run: the steps it follows, or `"always"`. */
type RunTrigger = ChangeStepResult[] | "always"

// Accept steps that can change the host in `after`, including another run.
// Reject an empty array, because a run that follows nothing never runs, which is a mistake.
const runTriggerSchema = type
  .declare<RunTrigger>()
  .type(type("'always'").or(changeStepResultSchema.array().atLeastLength(1)))

export interface RunOptions {
  /**
   * The results of the steps this run follows, so it runs when any of them changed. `"always"` runs it on every pass,
   * for upkeep with no trigger. In `plan` a run never runs, and reports changed when it would, so the plan shows it.
   */
  after: RunTrigger
}

// Validate the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
// Declare it against `RunOptions`, so the schema and the interface can't drift apart.
const runOptionsSchema = type.declare<RunOptions>().type({
  after: runTriggerSchema,
})

/** Returns whether the run is due: on every pass for `"always"`, or when a step in `after` changed. */
const evaluateTrigger = (options: RunOptions): boolean => {
  const { after } = options
  if (after === "always") return true

  const didAnyStepChange = after.some(({ changed }) => changed)
  return didAnyStepChange
}

export const handleRun = async (
  ctx: StepContext,
  change: unknown,
  options: unknown,
): Promise<Result<HandlerReturn<ChangeStepResult<"run">>>> => {
  const { stepName, mode } = ctx

  const validChange = changeSchema(change)
  if (validChange instanceof type.errors)
    return err(`failed to validate the command given to step '${stepName}'`, err(validChange.summary, undefined))

  const validOptions = runOptionsSchema(options)
  if (validOptions instanceof type.errors)
    return err(`failed to validate the options given to step '${stepName}'`, err(validOptions.summary, undefined))

  const shouldRun = evaluateTrigger(validOptions)
  if (!shouldRun) return withChangeStepResult(ctx, "run", { status: "unchanged" })
  if (mode === "plan") return withChangeStepResult(ctx, "run", { status: "ran" })

  const changeResult = await runChange(ctx, validChange)
  if (isErr(changeResult)) return err(`failed to run step '${stepName}'`, changeResult)

  return withChangeStepResult(ctx, "run", { status: "ran" })
}
