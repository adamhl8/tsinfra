import { type } from "arktype"

import type { EnvOptions, SudoOptions } from "#core/session/handlers/options/command.ts"
import { envOptionsSchema, sudoOptionsSchema } from "#core/session/handlers/options/command.ts"
import type { ChangeStepResult } from "#core/session/handlers/shared/change-step-result.ts"
import { changeStepResultSchema } from "#core/session/handlers/shared/change-step-result.ts"
import type { ChangeStepKind } from "#core/session/step.ts"

// Accept only steps that read the host's state in `needs`, so not a run.
const NEEDABLE_STEP_KINDS = ["file", "link", "dir", "ensure"] as const satisfies ChangeStepKind[]
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

/** The options that change how every command in a step runs, which `callStep` handles itself. */
export interface StepShellOptions extends SudoOptions, EnvOptions {}

// Check only the step's shell options, because a step's handler validates the rest, and ArkType ignores keys it doesn't
// name. Set the defaults in a pipe, because ArkType only allows a default on a required key.
export const stepShellOptionsSchema = type
  .declare<StepShellOptions>()
  .type(sudoOptionsSchema.and(envOptionsSchema))
  .pipe(({ sudo = false, env = {}, secretEnv = {} }) => ({ sudo, env, secretEnv }))

/** The shell options after validation, with their defaults set. */
export type ValidStepShellOptions = typeof stepShellOptionsSchema.infer

/** Removes the options `callStep` handles from `T`, leaving the ones a step's handler validates. */
export type HandlerOptions<T> = Omit<T, keyof StepShellOptions>
