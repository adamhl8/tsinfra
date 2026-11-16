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
import type { EnvOptions, HandlerOptions } from "#session/handlers/step-options/step-options.ts"
import type { HandlerReturn, StepContext } from "#session/step.ts"

/** What makes a run run: the steps it follows, or `"always"`. */
export type RunTrigger = ChangeStepResult[] | "always"

// Accept steps that can change the host in `after`, including another run.
// Reject an empty array, because a run that follows nothing never runs, which is a mistake.
const runTriggerSchema = type
  .declare<RunTrigger>()
  .type(type("'always'").or(changeStepResultSchema.array().atLeastLength(1)))

export interface RunOptions extends EnvOptions {
  /**
   * The results of the steps this run follows, so it runs when any of them changed. `"always"` runs it on every pass,
   * for upkeep with no trigger. In `plan` a run never runs, and reports changed when it would, so the plan shows it.
   */
  after: RunTrigger
}

// Validate the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
const runOptionsSchema = type.declare<HandlerOptions<RunOptions>>().type({
  after: runTriggerSchema,
})

/** Whether a run should trigger, and the open changes, still open from an earlier apply, that alone trigger it. */
interface TriggerEvaluation {
  shouldTrigger: boolean
  triggeringOpenChanges?: string[]
}

/**
 * Returns whether the run should trigger: on every pass for `"always"`, or when a step in `after` changed in this pass,
 * or has an open change missing this run.
 */
const evaluateTrigger = (ctx: StepContext<"run">, options: RunOptions): TriggerEvaluation => {
  const { stepName, savedStateManager, changedStepNames } = ctx
  const { after } = options
  if (after === "always") return { shouldTrigger: true }

  // Check `changedStepNames`, not `changed`, because `changed` is the script's value, not whether the step changed.
  // The script's `changed` is also true when the step's change is still open from an earlier apply.
  const didAnyStepChange = after.some(({ name }) => changedStepNames.has(name))
  if (didAnyStepChange) return { shouldTrigger: true }

  // Treat every open change missing this run as still open from an earlier apply, because no step in `after` changed.
  const followedStepNames = after.map(({ name }) => name)
  const triggeringOpenChanges = savedStateManager.getOpenChangesMissingFollowUp(stepName, followedStepNames)
  const isMissingFromOpenChanges = triggeringOpenChanges.length > 0
  return { shouldTrigger: isMissingFromOpenChanges, triggeringOpenChanges }
}

export const handleRun = async (
  ctx: StepContext<"run">,
  change: unknown,
  options: unknown,
): Promise<Result<HandlerReturn<ChangeStepResult<"run">>>> => {
  const { stepName, kind, mode, savedStateManager, recordTriggeringOpenChanges } = ctx

  const validChange = validateInput(change, changeSchema, { inputLabel: "command", givenTo: kind })
  if (isErr(validChange)) return validChange

  const validOptions = validateInput(options, runOptionsSchema, { inputLabel: "options", givenTo: kind })
  if (isErr(validOptions)) return validOptions

  const { shouldTrigger, triggeringOpenChanges } = evaluateTrigger(ctx, validOptions)
  if (!shouldTrigger) return withChangeStepResult(ctx, "unchanged")

  // Record what triggered the run before its command, so a failed run's record still says.
  recordTriggeringOpenChanges(triggeringOpenChanges)

  if (mode === "plan") return withChangeStepResult(ctx, "ran")

  // Open the run's own change before its command, so a run that follows this one still triggers if the host stops after it.
  const openChangeResult = await savedStateManager.openChange(stepName)
  if (isErr(openChangeResult)) return openChangeResult

  const changeResult = await runChange(ctx, validChange)
  if (isErr(changeResult)) return err("failed to run the step", changeResult)

  // Record the run on the open changes it followed, so a later apply knows it already ran after them.
  // Fail the step when that fails, because the run then triggers again next time, which is safe.
  const { after } = validOptions
  if (after !== "always") {
    const followedStepNames = after.map(({ name }) => name)
    const followUpRecord = await savedStateManager.recordFollowUp(stepName, followedStepNames)
    if (isErr(followUpRecord)) return followUpRecord
  }

  return withChangeStepResult(ctx, "ran")
}
