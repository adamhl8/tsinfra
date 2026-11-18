import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { ChangeStepKind, HandlerReturn, StepContext, StepStatus } from "#core/session/step.ts"
import { CHANGE_STEP_KINDS } from "#core/session/step.ts"

/**
 * What a change step gives back to the script, which may say that nothing changed. `K` is the method on `h` that ran
 * it, so `needs` can refuse a run's result.
 */
export interface ChangeStepResult<K extends ChangeStepKind = ChangeStepKind> {
  /** The step's name, which the output shows when another step needs this one. */
  name: string
  kind: K
  /**
   * True when the step changed something, or might in `plan` because it would change or waits on a step it needs. A
   * follow-up guarded by it shows up in the plan too. Also true when the step is in sync, but its change is still open
   * from an earlier apply, so the follow-ups that apply didn't finish still run.
   */
  changed: boolean
}

// Validate the results a script passes in, because a script can get past the types, like with `as` or `@ts-ignore`.
export const changeStepResultSchema = type.declare<ChangeStepResult>().type({
  name: "string",
  kind: type.enumerated(...CHANGE_STEP_KINDS),
  changed: "boolean",
})

// Count a waiting step as changed, so a step that needs it waits too, and a follow-up after it shows up in the plan.
// Count a `resume` step as changed, so the follow-ups an earlier apply didn't finish still trigger.
const COUNTS_AS_CHANGED: Record<StepStatus, boolean> = {
  unchanged: false,
  observed: false,
  changed: true,
  ran: true,
  ranAlways: true,
  ranFromOpenChanges: true,
  waiting: true,
  resume: true,
}

/**
 * Returns the step's status with the `ChangeStepResult` the script gets as its value. Makes an `unchanged` step whose
 * change is still open from an earlier apply `resume`.
 */
export const withChangeStepResult = <K extends ChangeStepKind>(
  ctx: StepContext<K>,
  handlerStatus: Result<StepStatus>,
): Result<HandlerReturn<ChangeStepResult<K>>> => {
  const { stepName, kind, savedStateManager, changedStepNames, ranAlwaysStepNames } = ctx
  if (isErr(handlerStatus)) return handlerStatus

  // Add the step from the handler's own status, before it can become `resume`, because the sets hold only the steps
  // that changed in this pass.
  if (COUNTS_AS_CHANGED[handlerStatus]) changedStepNames.add(stepName)
  if (handlerStatus === "ranAlways") ranAlwaysStepNames.add(stepName)

  // Open a step's change in this apply only right before it changes something, which makes it `changed`, `ran`, or
  // `ranAlways`. `plan` never opens one.
  // So an `unchanged` step's open change is one an earlier apply opened and never closed.
  const isStillOpenFromEarlierApply = handlerStatus === "unchanged" && savedStateManager.isOpen(stepName)
  const status = isStillOpenFromEarlierApply ? "resume" : handlerStatus

  return { status, value: { name: stepName, kind, changed: COUNTS_AS_CHANGED[status] } }
}
