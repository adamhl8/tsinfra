import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import { converge } from "#session/converge.ts"
import type { Change } from "#session/step-functions/change.ts"
import { changeSchema, runChange } from "#session/step-functions/change.ts"
import type { NeededSteps, StepContext, StepOutcome } from "#session/step.ts"
import { neededStepsSchema } from "#session/step.ts"
import type { Check } from "#session/steps/ensure/check.ts"
import { checkSchema, compareCheck } from "#session/steps/ensure/check.ts"

/** `T` ties a check function's return type to `want`, so a boolean check can't be compared to a string. */
export interface EnsureOptions<T extends string | boolean> {
  /**
   * A command, or a function given `read` that returns the value to compare. It also runs during `plan`, so it must not
   * change what the script manages.
   */
  check: Check<T>
  /**
   * The answer `check` gives when already right. `true` means a command exits 0, and `false` means it exits non-zero. A
   * string is compared to a command's stdout. Trailing newlines are ignored on both sides.
   */
  want: T
  /** A command, or a function that runs several commands by calling `exec`. It only runs in `apply`. */
  fix: Change
  /**
   * Runs the check again after the fix, and fails the step when it still fails. Defaults to true. Set it to false only
   * for a fix whose effect nothing in the run can make visible, like one that needs a reboot.
   */
  verify?: boolean
  /**
   * Earlier steps this step's check depends on. In `plan`, the step waits instead of checking when one of them would
   * change or is waiting. A run's result can't be needed, so need the step that triggered the run instead.
   */
  needs?: NeededSteps
}

// Validate the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
const ensureOptionsSchema = type.declare<EnsureOptions<string | boolean>>().type({
  check: checkSchema,
  want: "string | boolean",
  fix: changeSchema,
  "verify?": "boolean",
  "needs?": neededStepsSchema,
})

export const handleEnsure = async <T extends string | boolean>(
  ctx: StepContext,
  options: EnsureOptions<T>,
): Promise<Result<StepOutcome>> => {
  const { stepName } = ctx

  const validOptions = ensureOptionsSchema(options)
  if (validOptions instanceof type.errors)
    return err(`failed to validate the options given to step '${stepName}'`, err(validOptions.summary, undefined))

  const { check, want, fix, verify = true, needs = [] } = validOptions

  const outcome = await converge(ctx, {
    needs,
    compare: async () => compareCheck(ctx, check, want),
    fix: async () => runChange(ctx, fix),
    verify,
  })

  return outcome
}
