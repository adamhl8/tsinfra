import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { HandlerContext } from "#core/session/context.ts"
import type { EnvOptions } from "#core/session/handlers/options/command.ts"
import type { HandlerOptions } from "#core/session/handlers/options/step.ts"
import type { ChangeStepResult } from "#core/session/handlers/shared/change-step-result.ts"
import { changeStepResultSchema, withChangeStepResult } from "#core/session/handlers/shared/change-step-result.ts"
import { changeSchema, runChange } from "#core/session/handlers/shared/change.ts"
import { validateInput } from "#core/session/handlers/shared/validate-input.ts"
import type { FollowUpStatus, HandlerReturn } from "#core/session/step.ts"

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

/** The statuses a run's trigger gives it, before `withChangeStepResult` can make an `unchanged` one `resume`. */
type TriggerStatus = FollowUpStatus | "unchanged"

/**
 * Returns the run's status from its trigger: `ranAlways` for `"always"`, or when every step in `after` that changed in
 * this pass is `ranAlways`, `ran` when any other step in `after` changed in this pass, `ranFromOpenChanges` when a step
 * in `after` has an open change missing this run, and `unchanged` otherwise.
 */
const evaluateTrigger = (ctx: HandlerContext<"run">, options: RunOptions): TriggerStatus => {
  const { name: stepName } = ctx.step
  const { savedStateManager, stepHistory } = ctx.session
  const { changedNames, ranAlwaysNames } = stepHistory
  const { after } = options
  if (after === "always") return "ranAlways"

  // Check `changedNames`, not `changed`, because `changed` is the script's value, not whether the step changed.
  // The script's `changed` is also true when the step's change is still open from an earlier apply.
  const changedFollowedSteps = after.filter(({ name }) => changedNames.has(name))
  if (changedFollowedSteps.length > 0) {
    // Mark a run `ranAlways` when it follows only runs that run on every pass, because it then runs on every pass too.
    const isTriggeredOnlyByRanAlways = changedFollowedSteps.every(({ name }) => ranAlwaysNames.has(name))
    return isTriggeredOnlyByRanAlways ? "ranAlways" : "ran"
  }

  // Mark a run its open changes trigger `ranFromOpenChanges`, because no step in `after` changed in this pass.
  // Only changes still open from an earlier apply trigger it.
  const followedStepNames = after.map(({ name }) => name)
  const isMissingFromOpenChanges =
    savedStateManager.getOpenChangesMissingFollowUp(stepName, followedStepNames).length > 0
  return isMissingFromOpenChanges ? "ranFromOpenChanges" : "unchanged"
}

export const handleRun = async (
  ctx: HandlerContext<"run">,
  change: unknown,
  options: unknown,
): Promise<Result<HandlerReturn<ChangeStepResult<"run">>>> => {
  const { name: stepName, kind } = ctx.step
  const { mode, savedStateManager } = ctx.session

  const validChange = validateInput(change, changeSchema, { inputLabel: "command", givenTo: kind })
  if (isErr(validChange)) return validChange

  const validOptions = validateInput(options, runOptionsSchema, { inputLabel: "options", givenTo: kind })
  if (isErr(validOptions)) return validOptions

  const triggerStatus = evaluateTrigger(ctx, validOptions)
  if (triggerStatus === "unchanged") return withChangeStepResult(ctx, triggerStatus)
  if (mode === "plan") return withChangeStepResult(ctx, triggerStatus)

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

  return withChangeStepResult(ctx, triggerStatus)
}
