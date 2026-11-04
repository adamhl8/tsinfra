import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { ChangeStepKind, StepContext, StepOutcome, HandlerReturn } from "#session/step.ts"

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
// Declare it against `ChangeStepResult`, so the schema and the interface can't drift apart.
export const changeStepResultSchema = type.declare<ChangeStepResult>().type({
  name: "string",
  kind: "'file' | 'ensure' | 'run'",
  changed: "boolean",
})

// Accept only steps that read the host's state in `needs`, so not a run.
export const neededStepsSchema = changeStepResultSchema.and({ kind: "'file' | 'ensure'" }).array()
export type NeededSteps = typeof neededStepsSchema.infer

/** Returns `outcome` with the `ChangeStepResult` the script gets as its value. */
export const withChangeStepResult = <K extends ChangeStepKind>(
  ctx: StepContext,
  kind: K,
  outcome: Result<StepOutcome>,
): Result<HandlerReturn<ChangeStepResult<K>>> => {
  const { stepName } = ctx
  if (isErr(outcome)) return outcome

  return { outcome, value: { name: stepName, kind, changed: outcome.changed } }
}
