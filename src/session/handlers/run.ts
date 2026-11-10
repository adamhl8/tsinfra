import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { ChangeStepResult } from "#session/handlers/shared/shared.ts"
import {
  changeStepResultSchema,
  withChangeStepResult,
  changeSchema,
  runChange,
  validateInput,
} from "#session/handlers/shared/shared.ts"
import type { HandlerReturn, StepContext } from "#session/step.ts"

/** What makes a run run: the steps it follows, or `"always"`. */
export type RunTrigger = ChangeStepResult[] | "always"

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
  ctx: StepContext<"run">,
  change: unknown,
  options: unknown,
): Promise<Result<HandlerReturn<ChangeStepResult<"run">>>> => {
  const { kind, mode } = ctx

  const validChange = validateInput(change, changeSchema, { inputLabel: "command", givenTo: kind })
  if (isErr(validChange)) return validChange

  const validOptions = validateInput(options, runOptionsSchema, { inputLabel: "options", givenTo: kind })
  if (isErr(validOptions)) return validOptions

  const shouldRun = evaluateTrigger(validOptions)
  if (!shouldRun) return withChangeStepResult(ctx, "unchanged")
  if (mode === "plan") return withChangeStepResult(ctx, "ran")

  const changeResult = await runChange(ctx, validChange)
  if (isErr(changeResult)) return err("failed to run the step", changeResult)

  return withChangeStepResult(ctx, "ran")
}
