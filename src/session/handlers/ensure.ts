import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { Check, Want } from "#session/handlers/ensure/check.ts"
import { checkSchema, compareCheck, wantSchema } from "#session/handlers/ensure/check.ts"
import type { ChangeStepResult, StepNeeds } from "#session/handlers/shared/change-step-result.ts"
import { NO_NEEDS, stepNeedsSchema, withChangeStepResult } from "#session/handlers/shared/change-step-result.ts"
import type { Change } from "#session/handlers/shared/change.ts"
import { changeSchema, runChange } from "#session/handlers/shared/change.ts"
import { converge } from "#session/handlers/shared/converge.ts"
import { validateInput } from "#session/handlers/validate-input.ts"
import type { HandlerReturn, StepContext } from "#session/step.ts"

/** `T` ties a check function's return type to `want`, so a boolean check can't be compared to a string. */
export interface EnsureOptions<T extends Want> {
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
  needs?: StepNeeds
}

// Validate the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
// Set the defaults in a pipe, because ArkType only allows a default on a required key.
const ensureOptionsSchema = type
  .declare<EnsureOptions<Want>>()
  .type({
    check: checkSchema,
    want: wantSchema,
    fix: changeSchema,
    "verify?": "boolean",
    "needs?": stepNeedsSchema,
  })
  .pipe((options) => ({ verify: true, needs: NO_NEEDS, ...options }))

export const handleEnsure = async (
  ctx: StepContext<"ensure">,
  options: unknown,
): Promise<Result<HandlerReturn<ChangeStepResult<"ensure">>>> => {
  const { kind } = ctx

  const validOptions = validateInput(options, ensureOptionsSchema, { inputLabel: "options", givenTo: kind })
  if (isErr(validOptions)) return validOptions

  const { check, want, fix, verify, needs } = validOptions

  const outcome = await converge(ctx, {
    needs,
    compare: async () => compareCheck(ctx, check, want),
    fix: async () => runChange(ctx, fix),
    verify,
  })

  return withChangeStepResult(ctx, outcome)
}
