import { type } from "arktype"

import type { ChangeStepResult } from "#session/handlers/shared/change-step-result.ts"
import { changeStepResultSchema } from "#session/handlers/shared/change-step-result.ts"
import type { ChangeStepKind } from "#session/step.ts"

/** The `sudo` option, which `callStep` handles itself, before a step's handler runs. */
export interface SudoOptions {
  /** Runs the step's commands as root, in `plan` as well as `apply`. */
  sudo?: boolean
}

// Check only `sudo`, because a step's handler validates the rest of its options, and ArkType ignores keys it doesn't name.
// Set the default in a pipe, because ArkType only allows a default on a required key.
export const sudoOptionsSchema = type
  .declare<SudoOptions>()
  .type({ "sudo?": "boolean" })
  .pipe((options) => ({ sudo: false, ...options }))

// Accept only steps that read the host's state in `needs`, so not a run.
const NEEDABLE_STEP_KINDS = ["file", "link", "ensure"] as const satisfies ChangeStepKind[]
type NeedableStepKind = (typeof NEEDABLE_STEP_KINDS)[number]
/** The earlier steps a step depends on. */
export type StepNeeds = ChangeStepResult<NeedableStepKind>[]

/** The `needs` of a step that gives none. */
export const NO_NEEDS: StepNeeds = []

const stepNeedsSchema = type
  .declare<StepNeeds>()
  .type(changeStepResultSchema.and({ kind: type.enumerated(...NEEDABLE_STEP_KINDS) }).array())

/** The `needs` option, for a step that reads the host's state. */
export interface NeedsOptions {
  /**
   * Earlier steps this step depends on. In `plan`, the step waits instead of reading the host when one of them would
   * change or is waiting. A run's result can't be needed, so need the step that triggered the run instead.
   */
  needs?: StepNeeds
}

export const needsOptionsSchema = type.declare<NeedsOptions>().type({ "needs?": stepNeedsSchema })
