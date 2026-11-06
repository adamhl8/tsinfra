import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { ChangeStepKind, HandlerReturn, StepContext, StepStatus } from "#session/step.ts"
import { CHANGE_STEP_KINDS } from "#session/step.ts"

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
   * follow-up guarded by it shows up in the plan too.
   */
  changed: boolean
}

// Validate the results a script passes in, because a script can get past the types, like with `as` or `@ts-ignore`.
export const changeStepResultSchema = type.declare<ChangeStepResult>().type({
  name: "string",
  kind: type.enumerated(...CHANGE_STEP_KINDS),
  changed: "boolean",
})

// Accept only steps that read the host's state in `needs`, so not a run.
const NEEDABLE_STEP_KINDS = ["file", "ensure"] as const satisfies ChangeStepKind[]
type NeedableStepKind = (typeof NEEDABLE_STEP_KINDS)[number]
/** The earlier steps a step depends on. */
export type StepNeeds = ChangeStepResult<NeedableStepKind>[]

/** The `needs` of a step that gives none. */
export const NO_NEEDS: StepNeeds = []

export const stepNeedsSchema = type
  .declare<StepNeeds>()
  .type(changeStepResultSchema.and({ kind: type.enumerated(...NEEDABLE_STEP_KINDS) }).array())

// Count a waiting step as changed, so a step that needs it waits too, and a run that follows it shows up in the plan.
const COUNTS_AS_CHANGED: Record<StepStatus, boolean> = {
  unchanged: false,
  observed: false,
  changed: true,
  ran: true,
  waiting: true,
}

/** Returns `status` with the `ChangeStepResult` the script gets as its value. */
export const withChangeStepResult = <K extends ChangeStepKind>(
  ctx: StepContext<K>,
  status: Result<StepStatus>,
): Result<HandlerReturn<ChangeStepResult<K>>> => {
  const { stepName, kind } = ctx
  if (isErr(status)) return status

  return { status, value: { name: stepName, kind, changed: COUNTS_AS_CHANGED[status] } }
}
